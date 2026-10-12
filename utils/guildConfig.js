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

function addRoles(guildId, roleName, roleIds) {
    const guilds = readGuilds();
    const guild = guilds[guildId] || {};
    guild.roles = guild.roles || {};
    const listName = `${roleName}s`;
    const existingRoles = Array.isArray(guild.roles[listName])
        ? guild.roles[listName]
        : [];
    const uniqueRoleIds = [...new Set([
        guild.roles[roleName],
        ...existingRoles,
        ...roleIds
    ].filter(Boolean))];
    guild.roles[roleName] = uniqueRoleIds[0] || null;
    guild.roles[listName] = uniqueRoleIds;
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

function getCommandRoles(guildId, roleType) {
    const guild = readGuilds()[guildId];
    const roleIds = [getCommandRole(guildId, roleType)];
    if (roleType === 'training_officer') {
        const trainingOfficerRoles = guild?.roles?.TrainingOfficers;
        if (Array.isArray(trainingOfficerRoles)) {
            roleIds.push(...trainingOfficerRoles);
        }
        roleIds.push(getCommandRole(guildId, 'command'));
    }

    return [...new Set(roleIds.filter(Boolean))];
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

module.exports = { addRoles, getCommandRole, getCommandRoles, getGuildChannel, setGuildChannels, setRole };