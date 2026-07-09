import dns from 'dns';
const host = 'id.carfax.ca';
dns.resolve4(host, (err, addresses) => {
  if (err) {
    console.error(`Error resolving ${host}:`, err);
  } else {
    console.log(`Addresses for ${host}:`, addresses);
  }
  process.exit(0);
});
