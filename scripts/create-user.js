const fs = require('fs/promises');
const path = require('path');
const bcrypt = require('bcrypt');

const configPath = process.env.MC_PANEL_CONFIG || path.join(__dirname, '..', 'config.json');

async function main() {
  const [username, password] = process.argv.slice(2);
  if (!username || !password) {
    console.error('Usage: npm run create-user -- <username> <password>');
    process.exit(1);
  }

  const configRaw = await fs.readFile(configPath, 'utf-8');
  const config = JSON.parse(configRaw);
  const userFile = config.userFile;
  let users = [];

  try {
    const existing = await fs.readFile(userFile, 'utf-8');
    users = JSON.parse(existing);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }

  if (users.some((entry) => entry.username === username)) {
    console.error('User already exists.');
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  users.push({ username, passwordHash });
  await fs.mkdir(path.dirname(userFile), { recursive: true });
  await fs.writeFile(userFile, JSON.stringify(users, null, 2));
  console.log(`Created user: ${username}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
