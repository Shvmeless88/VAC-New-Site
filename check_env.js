
console.log("Checking Environment Variable Keys...");
const keys = Object.keys(process.env).sort();
console.log("Keys found:", keys.filter(k => !k.startsWith("TERM") && !k.startsWith("PATH")));
