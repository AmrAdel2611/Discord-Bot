const { Collection } = require('discord.js');
const fs = require('fs');

const commands = new Collection();

// Read all command files from the "commands" folder
const commandFiles = fs.readdirSync('./commands').filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const command = require(`../commands/${file}`);
    commands.set(command.data.name, command);
}

// Function to execute commands
async function executeCommand(interaction) {
    const command = commands.get(interaction.commandName);
    if (!command) return;

    try {
        await command.execute(interaction);
    } catch (error) {
        console.error(error);
        await interaction.reply({ content: 'There was an error executing this command!', ephemeral: true });
    }
}

module.exports = { executeCommand, commands };
