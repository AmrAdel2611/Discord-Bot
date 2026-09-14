const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '..', 'guilds.json');

function readGuilds() {
    if (!fs.existsSync(configPath)) {
        return {};
    }

    try {
        return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (error) {
        console.error('Failed to read guild configuration:', error.message);
        return {};
    }
}

function writeGuilds(guilds) {
    fs.writeFileSync(configPath, JSON.stringify(guilds, null, 2));
}

function setCommandRole(guildId, commandName, roleId) {
    const guilds = readGuilds();
    const guild = guilds[guildId] || { commands: {} };

    guild.commands = guild.commands || {};
    guild.commands[commandName] = { role_id: roleId };
    guilds[guildId] = guild;
    writeGuilds(guilds);
}

function getCommandRole(guildId, commandName) {
    const guild = readGuilds()[guildId];
    return guild?.commands?.[commandName]?.role_id || null;
}

function setGuildChannels(guildId, channels) {
    const guilds = readGuilds();
    const guild = guilds[guildId] || { commands: {} };

    guild.channels = {
        ...(guild.channels || {}),
        ...Object.fromEntries(
            Object.entries(channels).filter(([, channelId]) => channelId)
        )
    };
    guilds[guildId] = guild;
    writeGuilds(guilds);
}

function getGuildChannel(guildId, channelName, fallback = null) {
    return readGuilds()[guildId]?.channels?.[channelName] || fallback;
}

module.exports = { getCommandRole, getGuildChannel, setCommandRole, setGuildChannels };