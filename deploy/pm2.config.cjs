// pm2 process definition for TrueHumanNature.
// Env (NODE_ENV, DATA_DIR, SESSION_SECRET) is passed in by deploy/setup.sh via
// --update-env, so it isn't hard-coded here.
module.exports = {
  apps: [
    {
      name: "thn",
      script: "server.js",
      instances: 1,
      autorestart: true,
      max_memory_restart: "300M",
      env: { NODE_ENV: "production", PORT: "3000" },
    },
  ],
};
