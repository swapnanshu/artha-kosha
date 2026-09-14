const fs = require('fs');
let code = fs.readFileSync('app/oauth2callback/page.tsx', 'utf8');

code = code.replace(
  'const { token } = useAuth();',
  'const { token, loading } = useAuth();'
);

code = code.replace(
  'if (!token) {',
  'if (loading) return;\n        if (!token) {'
);

code = code.replace(
  '}, [code, oauthState, token]);',
  '}, [code, oauthState, token, loading]);'
);

fs.writeFileSync('app/oauth2callback/page.tsx', code);
console.log("Done");
