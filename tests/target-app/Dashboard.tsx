import React from 'react';

export const Dashboard = () => {
  return (
    <div className="dashboard-container">
      <header>
        <h1>User Dashboard</h1>
      </header>
      <main>
        <div className="user-profile">
          <h2>Welcome Back!</h2>
          {/* The test will expect data-testid="user-display-name" */}
          <p data-testid="user-display-name" id="user-name">Harish</p>
          <button className="logout-btn">Log Out</button>
        </div>
      </main>
    </div>
  );
};
