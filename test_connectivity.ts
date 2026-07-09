async function test() {
  try {
    const res = await fetch('https://www.carfax.ca');
    console.log("Status:", res.status);
  } catch (e) {
    console.error("Fetch failed:", e);
  }
}
test();
