/* ==========================================================================
   Sri Products — API client
   Every call is a POST with the body sent as text/plain. This is
   deliberate: Apps Script Web Apps cannot respond to a CORS preflight
   (OPTIONS) request, so a JSON content-type on the POST would break in
   the browser. text/plain is a "simple request" and skips preflight;
   the server (Code.gs) still JSON.parses the body normally.
   ========================================================================== */

const Api = (() => {
  // Set this to your deployed Apps Script /exec URL.
  const API_BASE_URL = window.SRI_CONFIG && window.SRI_CONFIG.API_BASE_URL
    ? window.SRI_CONFIG.API_BASE_URL
    : 'PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE';

  function getToken() {
    return localStorage.getItem('sri_token') || null;
  }

  function setToken(token) {
    if (token) localStorage.setItem('sri_token', token);
    else localStorage.removeItem('sri_token');
  }

  function getUser() {
    const raw = localStorage.getItem('sri_user');
    return raw ? JSON.parse(raw) : null;
  }

  function setUser(user) {
    if (user) localStorage.setItem('sri_user', JSON.stringify(user));
    else localStorage.removeItem('sri_user');
  }

  async function call(action, params) {
    if (API_BASE_URL.indexOf('PASTE_YOUR') === 0) {
      throw new Error('API_BASE_URL is not configured. Edit js/config.js with your Apps Script Web App URL.');
    }
    const body = Object.assign({ action: action, token: getToken() }, params || {});
    let response;
    try {
      response = await fetch(API_BASE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body)
      });
    } catch (networkErr) {
      throw new Error('Could not reach the server. Check your connection and try again.');
    }
    let json;
    try {
      json = await response.json();
    } catch (parseErr) {
      throw new Error('Unexpected response from server.');
    }
    if (!json.ok) {
      if (json.error && json.error.indexOf('log in again') !== -1) {
        setToken(null);
        setUser(null);
      }
      throw new Error(json.error || 'Something went wrong.');
    }
    return json.data;
  }

  return { call, getToken, setToken, getUser, setUser };
})();
