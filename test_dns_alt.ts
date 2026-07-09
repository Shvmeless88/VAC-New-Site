import dns from 'dns';
const host = 'api-can.carfax.ca';
dns.resolve4(host, (err, addresses) => {
  console.log(host, err ? 'FAILED' : addresses);
  process.exit(0);
});
