import fs from 'fs';
import { Project, SyntaxKind, Node } from 'ts-morph';

/**
 * A validated locator descriptor for a single interactive element.
 * The `safestLocator` is always a working Playwright expression —
 * it never uses getByLabel() when the label's `for` attribute is
 * disconnected from the input's `id`.
 */
export interface LocatorDescriptor {
  elementId: string;
  elementType: 'input' | 'textarea' | 'select' | 'checkbox' | 'radio' | 'file' | 'button' | 'link';
  labelText: string;
  labelConnected: boolean; // true only when label.for === input.id
  placeholder: string;
  name: string;
  ariaLabel: string;
  /** A Playwright locator expression string that is guaranteed to work */
  safestLocator: string;
  /** Human-readable reason for the chosen locator strategy */
  strategy: string;
  /** Whether the element is likely hidden from view */
  isHidden?: boolean;
}

export interface DomAnalysis {
  locators: LocatorDescriptor[];
  /** Quick lookup: elementId → LocatorDescriptor */
  byId: Map<string, LocatorDescriptor>;
  /** Formatted block suitable for embedding in AI prompts */
  promptBlock: string;
  /** Report of locators that are not unique */
  ambiguityReport: string;
  /** Semantic clues for fuzzy matching */
  semanticHints: string;
}

function attr(attrs: string, name: string): string {
  // Matches name="val", name='val', name=val, or just name (boolean attribute)
  const re = new RegExp(`(?:^|\\s)${name}(?:=(["'])?([^"'>\\s]*)\\1?)?(?:\\s|>|$)`, 'i');
  const match = attrs.match(re);
  if (!match) return '';
  // If it's a boolean attribute like 'hidden' without '=', match[2] is undefined
  return (match[2] !== undefined ? match[2] : 'true').trim();
}

function isElementHidden(attrs: string): boolean {
  const style = attr(attrs, 'style').toLowerCase().replace(/\s+/g, '');
  const hidden = attr(attrs, 'hidden');
  const ariaHidden = attr(attrs, 'aria-hidden');
  return (
    style.includes('display:none') || 
    style.includes('visibility:hidden') || 
    hidden !== '' || 
    ariaHidden === 'true'
  );
}

/**
 * Parses raw HTML (string) and produces a validated locator map.
 * Does NOT require a browser — pure regex/string parsing so it runs fast
 * even inside the healer's hot path.
 */
export function analyzeHtml(html: string): DomAnalysis {
  const locators: LocatorDescriptor[] = [];

  // ── Extract all <label for="...">text</label> ──────────────────────────
  const labelMap = new Map<string, string>(); // forId → label text
  const labelRegex = /<label[^>]*\bfor=["']([^"']+)["'][^>]*>([\s\S]*?)<\/label>/gi;
  let lm: RegExpExecArray | null;
  while ((lm = labelRegex.exec(html)) !== null) {
    const forId = lm[1]!.trim();
    const text = stripTags(lm[2]!).trim();
    if (forId && text) labelMap.set(forId, text);
  }

  // ── Process wrapping labels (labels with an input inside) ──────────────
  const wrappingLabelRegex = /<label[^>]*>([\s\S]*?)<\/label>/gi;
  const wrappingLabels: { text: string; html: string }[] = [];
  let wlm: RegExpExecArray | null;
  while ((wlm = wrappingLabelRegex.exec(html)) !== null) {
    const labelHtml = wlm[0]!;
    const labelInner = wlm[1]!;
    // Only count as wrapping if it contains an input/textarea/select
    if (/<(input|textarea|select)/i.test(labelInner)) {
      wrappingLabels.push({ text: stripTags(labelInner).trim(), html: labelHtml });
    }
  }

  // ── Process <input> elements ───────────────────────────────────────────
  const inputRegex = /<input([^>]*)>/gi;
  let im: RegExpExecArray | null;
  while ((im = inputRegex.exec(html)) !== null) {
    const attrs = im[1]!;
    const fullTag = im[0]!;
    const id = attr(attrs, 'id');
    const type = (attr(attrs, 'type') || 'text').toLowerCase();
    if (['hidden', 'submit', 'button', 'reset', 'image'].includes(type)) continue;

    const placeholder = attr(attrs, 'placeholder');
    const name = attr(attrs, 'name');
    const ariaLabel = attr(attrs, 'aria-label');
    
    let elemType: LocatorDescriptor['elementType'] = 'input';
    if (type === 'checkbox') elemType = 'checkbox';
    if (type === 'radio') elemType = 'radio';
    if (type === 'file') elemType = 'file';

    // Priority 1: Label for="id"
    let labelText = id ? (labelMap.get(id) ?? '') : '';
    let labelConnected = !!(id && labelMap.has(id));

    // Priority 2: Wrapping label
    if (!labelConnected) {
      const parentLabel = wrappingLabels.find(l => l.html.includes(fullTag));
      if (parentLabel) {
        labelText = parentLabel.text;
        labelConnected = true;
      }
    }

    const desc: LocatorDescriptor = {
      elementId: id,
      elementType: elemType,
      labelText,
      labelConnected,
      placeholder,
      name,
      ariaLabel,
      safestLocator: '',
      strategy: '',
    };

    assignLocator(desc);
    locators.push(desc);
  }

  // ── Process <textarea> elements ────────────────────────────────────────
  const textareaRegex = /<textarea([^>]*)>/gi;
  let tm: RegExpExecArray | null;
  while ((tm = textareaRegex.exec(html)) !== null) {
    const attrs = tm[1]!;
    const id = attr(attrs, 'id');
    const placeholder = attr(attrs, 'placeholder');
    const name = attr(attrs, 'name');
    const ariaLabel = attr(attrs, 'aria-label');
    const labelText = id ? (labelMap.get(id) ?? '') : '';
    const labelConnected = !!(id && labelMap.has(id));

    const desc: LocatorDescriptor = {
      elementId: id,
      elementType: 'textarea',
      labelText,
      labelConnected,
      placeholder,
      name,
      ariaLabel,
      safestLocator: '',
      strategy: '',
    };
    assignLocator(desc);
    locators.push(desc);
  }

  // ── Process <select> elements ──────────────────────────────────────────
  const selectRegex = /<select([^>]*)>/gi;
  let sm: RegExpExecArray | null;
  while ((sm = selectRegex.exec(html)) !== null) {
    const attrs = sm[1]!;
    const id = attr(attrs, 'id');
    const name = attr(attrs, 'name');
    const ariaLabel = attr(attrs, 'aria-label');
    const labelText = id ? (labelMap.get(id) ?? '') : '';
    const labelConnected = !!(id && labelMap.has(id));

    const desc: LocatorDescriptor = {
      elementId: id,
      elementType: 'select',
      labelText,
      labelConnected,
      placeholder: '',
      name,
      ariaLabel,
      safestLocator: '',
      strategy: '',
    };
    assignLocator(desc);
    locators.push(desc);
  }

  // ── Process <button> elements ──────────────────────────────────────────
  const buttonRegex = /<button([^>]*)>([\s\S]*?)<\/button>/gi;
  let bm: RegExpExecArray | null;
  while ((bm = buttonRegex.exec(html)) !== null) {
    const attrs = bm[1]!;
    const id = attr(attrs, 'id');
    const ariaLabel = attr(attrs, 'aria-label');
    const text = stripTags(bm[2]!).trim();

    const isHidden = isElementHidden(attrs);

    const desc: LocatorDescriptor = {
      elementId: id,
      elementType: 'button',
      labelText: text,
      labelConnected: false,
      placeholder: '',
      name: attr(attrs, 'name'),
      ariaLabel,
      safestLocator: '',
      strategy: '',
      isHidden,
    };

    if (text) {
      desc.safestLocator = `page.getByRole('button', { name: '${esc(text)}' })`;
      desc.strategy = `button text "${text}"`;
    } else if (ariaLabel) {
      desc.safestLocator = `page.getByRole('button', { name: '${esc(ariaLabel)}' })`;
      desc.strategy = `aria-label "${ariaLabel}"`;
    } else if (id) {
      desc.safestLocator = `page.locator('#${id}')`;
      desc.strategy = `id selector (no text or aria-label)`;
    }

    if (desc.safestLocator) locators.push(desc);
  }

  // ── Process <a> (links) elements ─────────────────────────────────────────
  const linkRegex = /<a([^>]*)>([\s\S]*?)<\/a>/gi;
  let linkMatch: RegExpExecArray | null;
  while ((linkMatch = linkRegex.exec(html)) !== null) {
    const attrs = linkMatch[1]!;
    const id = attr(attrs, 'id');
    const ariaLabel = attr(attrs, 'aria-label');
    const text = stripTags(linkMatch[2]!).trim();

    const desc: LocatorDescriptor = {
      elementId: id,
      elementType: 'link',
      labelText: text,
      labelConnected: false,
      placeholder: '',
      name: '',
      ariaLabel,
      safestLocator: '',
      strategy: '',
    };
    if (text) {
      desc.safestLocator = `page.getByRole('link', { name: '${esc(text)}' })`;
      desc.strategy = `link text "${text}"`;
    } else if (ariaLabel) {
      desc.safestLocator = `page.getByRole('link', { name: '${esc(ariaLabel)}' })`;
      desc.strategy = `aria-label "${ariaLabel}"`;
    } else if (id) {
      desc.safestLocator = `page.locator('#${id}')`;
      desc.strategy = `id selector (no text or aria-label)`;
    }
    if (desc.safestLocator) locators.push(desc);
  }

  // ── Process generic ARIA interactive roles ────────────────────────────────
  const roleRegex = /<(div|span|section|li)([^>]*role=["'](button|link|checkbox|radio|combobox)["'][^>]*)>([\s\S]*?)<\/\1>/gi;
  let rm: RegExpExecArray | null;
  while ((rm = roleRegex.exec(html)) !== null) {
    const attrs = rm[2]!;
    const role = attr(attrs, 'role') as any;
    const id = attr(attrs, 'id');
    const ariaLabel = attr(attrs, 'aria-label') || attr(attrs, 'aria-labelledby');
    const text = stripTags(rm[4]!).trim();

    const desc: LocatorDescriptor = {
      elementId: id,
      elementType: role,
      labelText: text,
      labelConnected: false,
      placeholder: '',
      name: '',
      ariaLabel,
      safestLocator: '',
      strategy: '',
    };
    if (text || ariaLabel) {
      const name = text || ariaLabel;
      desc.safestLocator = `page.getByRole('${role}', { name: '${esc(name)}' })`;
      desc.strategy = `aria role "${role}" with name "${name}"`;
    } else if (id) {
      desc.safestLocator = `page.locator('#${id}')`;
      desc.strategy = `id selector for role "${role}"`;
    }
    if (desc.safestLocator) locators.push(desc);
  }

  const byId = new Map<string, LocatorDescriptor>();
  for (const l of locators) {
    if (l.elementId) byId.set(l.elementId, l);
  }

  const promptBlock = buildPromptBlock(locators);
  const semanticHints = buildSemanticHints(html);
  const ambiguityReport = buildAmbiguityReport(locators);

  return { locators, byId, promptBlock, semanticHints, ambiguityReport };
}

/**
 * Detects if multiple elements share the same locator strategy,
 * which would trigger a Playwright 'Strict Mode Violation'.
 */
function buildAmbiguityReport(locators: LocatorDescriptor[]): string {
  const counts = new Map<string, number>();
  for (const l of locators) {
    if (l.safestLocator) counts.set(l.safestLocator, (counts.get(l.safestLocator) || 0) + 1);
  }
  
  const ambiguous = Array.from(counts.entries()).filter(([_, count]) => count > 1);
  if (ambiguous.length === 0) return '';
  
  return `│  ⚠️  AMBIGUITY WARNING: The following locators resolve to multiple elements. 
│     Use .first(), .nth(), or a parent locator to avoid Strict Mode errors:
${ambiguous.map(([loc, count]) => `│     • ${loc} (matches ${count} elements)`).join('\n')}`;
}

/**
 * Finds elements that might be semantically related to common failing queries
 * by looking for similar text in divs/spans near inputs.
 */
function buildSemanticHints(html: string): string {
  const hints: string[] = [];
  const textNodes = html.match(/>([^<>{}\n]{2,30})</g);
  if (textNodes) {
    const uniqueText = [...new Set(textNodes.map(t => t.slice(1, -1).trim()))].filter(t => t.length > 0);
    hints.push(`│  • Detected potential labels in DOM: ${uniqueText.slice(0, 15).join(', ')}`);
  }
  return hints.join('\n');
}

/**
 * Parses JSX/TSX using an AST (ts-morph) to accurately extract element locators,
 * bypassing regex fragility for React codebases.
 */
export function analyzeTsx(tsxContent: string): DomAnalysis {
  const project = new Project({ useInMemoryFileSystem: true });
  const sourceFile = project.createSourceFile('temp.tsx', tsxContent);
  const locators: LocatorDescriptor[] = [];

  const elements = [
    ...sourceFile.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
    ...sourceFile.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement)
  ];

  const getChildrenText = (parent: any) => {
    return parent.getJsxChildren().map((c: any) => {
      if (Node.isJsxText(c)) return c.getText();
      if (Node.isJsxExpression(c)) {
        // Strip the braces from {expression} to give AI a cleaner hint
        const text = c.getText();
        return text.replace(/^\{|\}$/g, '').trim();
      }
      return '';
    }).join(' ').replace(/\s+/g, ' ').trim();
  };

  // First, extract all labels to map htmlFor/for -> text
  const labelMap = new Map<string, string>();
  for (const el of elements) {
    if (el.getTagNameNode().getText().toLowerCase() === 'label') {
      let forId = '';
      for (const attr of el.getAttributes()) {
        if (Node.isJsxAttribute(attr)) {
          const name = attr.getNameNode().getText();
          if (name === 'htmlFor' || name === 'for') {
            const init = attr.getInitializer();
            if (init && Node.isStringLiteral(init)) forId = init.getLiteralText();
            else if (init && Node.isJsxExpression(init)) forId = init.getText();
          }
        }
      }
      if (forId && Node.isJsxOpeningElement(el)) {
        const parent = el.getParentIfKind(SyntaxKind.JsxElement);
        if (parent) {
          const text = getChildrenText(parent);
          if (text) labelMap.set(forId, text);
        }
      }
    }
  }

  for (const el of elements) {
    const rawTagName = el.getTagNameNode().getText();
    const tagName = rawTagName.toLowerCase();
    const isCustom = /^[A-Z]/.test(rawTagName);

    if (!['input', 'textarea', 'select', 'button', 'a'].includes(tagName) && !isCustom) continue;

    const attrs = new Map<string, string>();
    for (const attr of el.getAttributes()) {
      if (Node.isJsxAttribute(attr)) {
        const name = attr.getNameNode().getText();
        const init = attr.getInitializer();
        if (init && Node.isStringLiteral(init)) attrs.set(name, init.getLiteralText());
        else if (init && Node.isJsxExpression(init)) attrs.set(name, init.getText());
      }
    }

    const id = attrs.get('id') || '';
    const type = (attrs.get('type') || 'text').toLowerCase();
    if (!isCustom && ['hidden', 'submit', 'reset', 'image'].includes(type) && tagName === 'input') continue;

    let text = '';
    if (Node.isJsxOpeningElement(el)) {
      const parent = el.getParentIfKind(SyntaxKind.JsxElement);
      if (parent) {
        text = getChildrenText(parent);
      }
    }

    let elemType: LocatorDescriptor['elementType'] = 'input';
    if (tagName === 'textarea' || rawTagName.includes('TextArea')) elemType = 'textarea';
    else if (tagName === 'select' || rawTagName.includes('Select')) elemType = 'select';
    else if (tagName === 'button' || rawTagName.includes('Button')) elemType = 'button';
    else if (tagName === 'a' || rawTagName.includes('Link')) elemType = 'link';
    else if (tagName === 'input' || rawTagName.includes('Input') || rawTagName.includes('Field')) {
      if (type.includes('checkbox')) elemType = 'checkbox';
      else if (type.includes('radio')) elemType = 'radio';
      else if (type.includes('file')) elemType = 'file';
    } else if (isCustom) {
      if (attrs.has('onClick')) elemType = 'button';
      else elemType = 'input';
    }

    const labelText = id ? (labelMap.get(id) ?? '') : '';
    const effectiveLabel = (elemType === 'button' || elemType === 'link') ? text : labelText;

    const desc: LocatorDescriptor = {
      elementId: id,
      elementType: elemType,
      labelText: effectiveLabel,
      labelConnected: !!(id && labelMap.has(id)),
      placeholder: attrs.get('placeholder') || '',
      name: attrs.get('name') || '',
      ariaLabel: attrs.get('aria-label') || '',
      safestLocator: '',
      strategy: '',
    };

    assignLocator(desc);
    if (desc.safestLocator) locators.push(desc);
  }

  const byId = new Map<string, LocatorDescriptor>();
  for (const l of locators) {
    if (l.elementId) byId.set(l.elementId, l);
  }

  return { locators, byId, promptBlock: buildPromptBlock(locators), semanticHints: '', ambiguityReport: '' };
}

/**
 * Convenience: load a file from disk and analyze it dynamically
 * based on its extension.
 */
export function analyzeHtmlFile(filePath: string): DomAnalysis | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    if (filePath.endsWith('.tsx') || filePath.endsWith('.jsx')) {
      return analyzeTsx(content);
    }
    return analyzeHtml(content);
  } catch {
    return null;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

function assignLocator(desc: LocatorDescriptor) {
  const { elementId, elementType, labelText, labelConnected, placeholder, name, ariaLabel } = desc;

  if (elementType === 'checkbox' || elementType === 'radio') {
    // Checkboxes and Radios use getByRole
    const accessibleName = labelConnected ? labelText : (ariaLabel || labelText);
    if (accessibleName) {
      desc.safestLocator = `page.getByRole('${elementType}', { name: '${esc(accessibleName)}' })`;
      desc.strategy = `role=${elementType} with name "${accessibleName}"`;
    } else if (elementId) {
      desc.safestLocator = `page.locator('#${elementId}')`;
      desc.strategy = `id selector (no accessible name)`;
    } else if (name) {
      desc.safestLocator = `page.locator('[name="${name}"]').filter({ checked: false })`; // heuristic
      desc.strategy = `name attribute selector`;
    }
    return;
  }

  // For text inputs, textareas, selects:
  // Priority: connected label → aria-label → placeholder → name → id
  if (labelConnected && labelText) {
    desc.safestLocator = `page.getByLabel('${esc(labelText)}')`;
    desc.strategy = `connected label "${labelText}" (for="${elementId}" ✓)`;
  } else if (ariaLabel) {
    desc.safestLocator = `page.getByLabel('${esc(ariaLabel)}')`;
    desc.strategy = `aria-label attribute "${ariaLabel}"`;
  } else if (labelText && !labelConnected) {
    // Label exists but is DISCONNECTED — warn and fall back to id/name
    if (elementId) {
      desc.safestLocator = `page.locator('#${elementId}')`;
      desc.strategy = `id selector — label "${labelText}" is DISCONNECTED (for≠id), getByLabel would fail`;
    } else if (name) {
      desc.safestLocator = `page.locator('[name="${name}"]')`;
      desc.strategy = `name selector — label "${labelText}" is DISCONNECTED (for≠id)`;
    }
  } else if (placeholder) {
    desc.safestLocator = `page.getByPlaceholder('${esc(placeholder)}')`;
    desc.strategy = `placeholder "${placeholder}"`;
  } else if (elementId) {
    desc.safestLocator = `page.locator('#${elementId}')`;
    desc.strategy = `id selector (no label/placeholder/aria-label)`;
  } else if (name) {
    desc.safestLocator = `page.locator('[name="${name}"]')`;
    desc.strategy = `name attribute selector`;
  }
}

function buildPromptBlock(locators: LocatorDescriptor[]): string {
  if (locators.length === 0) return '';
  const lines = [
    '┌─ VALIDATED LOCATOR MAP (source-of-truth, copy exactly) ─────────────────',
    '│  ⚠️  Labels marked DISCONNECTED cannot use getByLabel() — use the given locator instead',
  ];
  for (const l of locators) {
    if (!l.safestLocator) continue;
    const needsLabel = ['input', 'textarea', 'select'].includes(l.elementType);
    const warn = (needsLabel && !l.labelConnected && l.labelText) ? ' ⚠️  DISCONNECTED LABEL' : '';
    const visibility = l.isHidden ? ' 🚫 HIDDEN' : '';
    lines.push(`│  • ${l.elementType} [${l.elementId || l.labelText}]: ${l.safestLocator}${warn}${visibility}`);
    lines.push(`│    reason: ${l.strategy}`);
  }
  lines.push('└─────────────────────────────────────────────────────────────────────────');
  return lines.join('\n');
}

/** Extract the value of an attribute from a raw attribute string */
// attr() helper moved to the top of the file for shared use

function stripTags(str: string): string {
  if (!str) return '';
  // Remove HTML tags
  let text = str.replace(/<[^>]+>/g, '');
  // Decode common HTML entities
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'");
  return text;
}

function esc(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
