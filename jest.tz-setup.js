// Run every test outside the UK zone so nothing relies on the device timezone.
module.exports = async () => {
  process.env.TZ = 'America/New_York';
};
