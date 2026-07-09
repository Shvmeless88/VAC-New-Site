import dns from 'dns';
const host = 'developer.carfax.ca';
dns.resolve4(host, (err, addresses) => {
  console.log(host, err ? 'FAILED' : addresses);
  process.exit(0);
});
