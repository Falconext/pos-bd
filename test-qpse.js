const axios = require('axios');

async function run() {
  try {
    const res = await axios.post('https://demo-cpe.qpse.pe/api/auth/cpe/token', {
      username: '0HGRQ55B',
      password: 'password_here' // We don't have the password, so this won't work
    });
    console.log(res.data);
  } catch (e) {
    console.log(e.response?.data || e.message);
  }
}
run();
