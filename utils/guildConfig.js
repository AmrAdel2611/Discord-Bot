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

function setRole(guildId, roleName, roleId) {
    const guilds = readGuilds();
    const guild = guilds[guildId] || {};

    guild.roles = guild.roles || {};
    guild.roles[roleName] = roleId;
    guilds[guildId] = guild;
    writeGuilds(guilds);
}

function getCommandRole(guildId, roleType) {
    const guild = readGuilds()[guildId];
    const roleName = roleType === 'training_officer' ? 'TrainingOfficer' : 'Command';
    return guild?.roles?.[roleName]
        || guild?.commands?.[roleType]?.role_id
        || null;
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

module.exports = { getCommandRole, getGuildChannel, setGuildChannels, setRole };