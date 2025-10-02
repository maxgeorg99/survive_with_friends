import React from 'react';
import ReactDOM from 'react-dom/client';
import { AuthProvider } from 'react-oidc-context';
import { OidcDebug } from './src/OidcDebug';

// Import your Phaser game
import './src/main';

const oidcConfig = {
  authority: 'https://spacetimeauth.staging.spacetimedb.com/oidc',
  client_id: 'client_031CSnBZhPFgz5oj5Alo0a',
  redirect_uri: `${window.location.origin}/callback`,
  scope: 'openid profile email',
  response_type: 'code',
  automaticSilentRenew: true,
};

function onSigninCallback() {
  window.history.replaceState({}, document.title, window.location.pathname);
}

// React component that wraps your Phaser game
function App() {
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      {/* The gameContainer div that your Phaser game uses */}
      <div id="gameContainer" style={{ width: '100%', height: '100%' }}></div>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);
root.render(
  <AuthProvider {...oidcConfig} onSigninCallback={onSigninCallback}>
    <OidcDebug />
    <App />
  </AuthProvider>
);