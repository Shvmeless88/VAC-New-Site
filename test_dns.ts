import dns from 'dns';
const host = 'identity.carfax.ca';
const resolver = new dns.Resolver();
resolver.setServers(['8.8.8.8']);
resolver.resolve4(host, (err, addresses) => {
  if (err) {
    console.error(`Error resolving ${host}:`, err);
  } else {
    console.log(`Addresses for ${host}:`, addresses);
  }
  process.exit(0);
});
