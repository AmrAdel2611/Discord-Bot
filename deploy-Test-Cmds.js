const { REST, Routes } = require('discord.js');
const fs = require('fs');
require('dotenv').config();

const clientId = process.env.TEST_CLIENT_ID;
const token = process.env.TEST_TOKEN;

if (!clientId || !token) {
    const missing = [
        !clientId && 'TEST_CLIENT_ID',
        !token && 'TEST_TOKEN'
    ].filter(Boolean);

    console.error(`❌ Missing required environment variable(s): ${missing.join(', ')}`);
    console.error('Add them to .env and run this script again. TEST_CLIENT_ID is the Discord application ID.');
    process.exit(1);
}

const commands = [];
const commandFiles = fs.readdirSync('./commands').filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const command = require(`./commands/${file}`);
    commands.push(command.data.toJSON());
}

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
    try {
        console.log('🧹 Adding all global commands...');
        await rest.put(Routes.applicationCommands(clientId), { body: commands });
        console.log('✅ Global commands added.');
    } catch (error) {
        console.error('❌ Deployment failed:', error);
    }
})();
