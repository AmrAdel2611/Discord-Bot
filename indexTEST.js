const { Client, GatewayIntentBits, Collection } = require('discord.js');
require('dotenv').config();
const fs = require('fs');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions
    ]
});

// Load slash commands
client.commands = new Collection();
const commandFiles = fs.readdirSync('./commands').filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const command = require(`./commands/${file}`);
    client.commands.set(command.data.name, command);
}

console.log("✅ Loaded Commands:", [...client.commands.keys()]);

client.once('ready', async () => {
    console.log(`🟢 Logged in: ${client.user.tag}`);
});

process.on('SIGINT', async () => {
    console.log(`🔴 Logged out: ${client.user.tag}`);
    process.exit(0);
});

// Slash command interaction handler
client.on('interactionCreate', async interaction => {
    if (interaction.isButton()) {
        const commandName = interaction.customId.split(':')[0];
        const command = client.commands.get(commandName);
        if (command?.handleButton) {
            await command.handleButton(interaction);
        }
        return;
    }

    if (interaction.isAutocomplete()) {
        const focusedOption = interaction.options.getFocused(true);
        if (interaction.commandName === 'faction') {
            const subcommand = interaction.options.getSubcommand(false);
            if (subcommand === 'edit' && focusedOption.name === 'countrycode') {
                return autoCompleteCountry(interaction);
            }
        }

        const command = client.commands.get(interaction.commandName);
        if (command && command.autocomplete) {
            await command.autocomplete(interaction);
        }
        return;
    }


    if (!interaction.isCommand()) return;

    if (!interaction.inGuild()) {
        return interaction.reply({content: "❌ This command can only be used within a server."});
    }


    const command = client.commands.get(interaction.commandName);
    if (!command) {
        console.log(`⚠️ Command not found: ${interaction.commandName}`);
        return interaction.reply({ content: "Command not recognized!", ephemeral: true });
    }

    try {
        await command.execute(interaction);
    } catch (error) {
        console.error("❌ Error executing command:", error);
        await interaction.reply({ content: "An error occurred while executing the command.", ephemeral: true });
    }
});

// Load event listeners
const eventFiles = fs.readdirSync('./handlers').filter(file => file.endsWith('.js'));

for (const file of eventFiles) {
    const event = require(`./handlers/${file}`);
    client.on(event.name, (...args) => event.execute(...args));
}



client.login(process.env.TEST_TOKEN);
