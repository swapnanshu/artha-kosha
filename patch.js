const fs = require('fs');
let code = fs.readFileSync('components/onboarding-flow.tsx', 'utf8');

const oldCode = `  const beginGmailOAuth = async (which: 'gmail1' | 'gmail2') => {
    if (!token) return;
    setOauthLoading(which);
    
    // Open a blank popup immediately to avoid popup blockers
    const popup = window.open('', '_blank', 'width=500,height=600');
    
    try {
      const state = which === 'gmail1' ? 'gmail1' : 'gmail2';
      const res = await fetch(\`/api/ingestion/oauth-start?state=\${encodeURIComponent(state)}\`);
      const data = await res.json();
      
      if (!res.ok) throw new Error(data?.error || 'Failed to start OAuth');

      // Redirect the popup to Google
      if (popup) {
        popup.location.href = data.url;
      } else {
        // Fallback if popup was blocked
        window.open(data.url, '_blank', 'width=500,height=600');
      }
    } catch (err) {
      if (popup) popup.close();
    } finally {
      setOauthLoading(null);
    }
  };`;

const newCode = `  const beginGmailOAuth = async (which: 'gmail1' | 'gmail2') => {
    if (!token) return;
    setOauthLoading(which);
    
    try {
      const state = which === 'gmail1' ? 'gmail1' : 'gmail2';
      const res = await fetch(\`/api/ingestion/oauth-start?state=\${encodeURIComponent(state)}\`);
      const data = await res.json();
      
      if (!res.ok) throw new Error(data?.error || 'Failed to start OAuth');

      // Redirect to Google directly
      window.location.href = data.url;
    } catch (err: any) {
      addToast({ title: 'OAuth Error', message: err?.message || 'Failed to connect', kind: 'error' });
    } finally {
      setOauthLoading(null);
    }
  };`;

code = code.replace(oldCode, newCode);
fs.writeFileSync('components/onboarding-flow.tsx', code);
console.log("Done");
