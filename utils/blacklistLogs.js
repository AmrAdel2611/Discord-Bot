const fs = require('fs');
const path = require('path');
const { 
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    TextDisplayBuilder,
    SeparatorBuilder,
    MessageFlags,
    ContainerBuilder
 } = require('discord.js');

const statePath = path.join(__dirname, '..', 'blacklist_logs.json');
const guildsConfigPath = path.join(__dirname, '..', 'guilds.json');

function getGuildBlacklistChannel(guildId) {
    if (!fs.existsSync(guildsConfigPath)) return null;

    try {
        const raw = fs.readFileSync(guildsConfigPath, 'utf8');
        const guilds = JSON.parse(raw);
        // Extracts channels.blacklist for the specific guild ID
        return guilds[guildId]?.channels?.blacklist || null;
    } catch (err) {
        console.error('Failed to read guilds.json:', err.message);
        return null;
    }
}

function getFormattedDate() {
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    return `${day}.${month}.${year}`;
}

// State Functions

function normalizeBlacklistState(state) {
    const source = state && typeof state === 'object' && !Array.isArray(state) ? state : {};
    const embedConfig = source.embedConfig === undefined ? {} : source.embedConfig;
    if (!embedConfig || typeof embedConfig !== 'object' || Array.isArray(embedConfig)) {
        throw new Error('Blacklist embedConfig must be an object.');
    }
    if (source.bl_users !== undefined && !Array.isArray(source.bl_users)) {
        throw new Error('Blacklist bl_users must be an array.');
    }
    if (source.logs !== undefined && !Array.isArray(source.logs)) {
        throw new Error('Blacklist logs must be an array.');
    }

    const normalizedEmbedConfig = { ...embedConfig };
    if (!Object.prototype.hasOwnProperty.call(normalizedEmbedConfig, 'channelId')) {
        normalizedEmbedConfig.channelId = null;
    }
    if (!Object.prototype.hasOwnProperty.call(normalizedEmbedConfig, 'messageId')) {
        normalizedEmbedConfig.messageId = null;
    }

    return {
        ...source,
        embedConfig: normalizedEmbedConfig,
        bl_users: Array.isArray(source.bl_users) ? source.bl_users : [],
        logs: Array.isArray(source.logs) ? source.logs : []
    }
}

function normalizeName(name) {
    return name.trim().toLowerCase();
}

function extractForumName(forumLink) {
    try {
        const url = new URL(forumLink);
        if (!['http:', 'https:'].includes(url.protocol)) return null;

        const forumName = url.pathname.split('/').filter(Boolean).pop();
        return forumName ? decodeURIComponent(forumName) : null;
    } catch {
        return null;
    }
}

function formatLink(label, value, linkText) {
    const link = typeof value === 'string' ? value.trim() : '';
    if (!link) return `• **${label}:** N/A`;

    try {
        const url = new URL(link);
        if (['http:', 'https:'].includes(url.protocol)) {
            return `• **${label}:** [${linkText || 'Open'}](${url.toString()})`;
        }
    } catch {
        // Preserve existing non-URL values so legacy records remain visible.
    }

    return `• **${label}:** ${link}`;
}

function readBlacklistState() {
    if (!fs.existsSync(statePath)) {
        return { bl_users: [], logs: [] };
    }

    try {
        const state = normalizeBlacklistState(JSON.parse(fs.readFileSync(statePath, 'utf8')));
        writeBlacklistState(state);
        return state;
    } catch (error) {
        console.error('Failed to read blacklist log state:', error.message);
        return { bl_users: [], logs: [] };
    }
}

function writeBlacklistState(state) {
    try {
        // Run state through normalizeState to ensure only clean data gets saved
        const cleanState = normalizeBlacklistState(state);
        
        fs.writeFileSync(
            statePath,
            JSON.stringify(cleanState, null, 2),
            'utf8'
        );
    } catch (error) {
        console.error('Failed to write blacklist log state:', error.message);
    }
}

// Blacklist Management Functions

function isBlacklisted(user) {
    const state = readBlacklistState();
    if (!user || !Array.isArray(state?.bl_users) || state.bl_users.length === 0) {
        return false;
    }

    const normalizedUser = normalizeName(user);
    const found = state.bl_users.some(blUser => blUser && normalizeName(blUser) === normalizedUser);
    
    console.log('[DEBUG isBlacklisted] Match result:', found);
    return found;
}

function addBlacklistUser(user, reason, length, ucpLink, interviewer, forumLink) {
    const alreadyExists = isBlacklisted(user);

    if (alreadyExists) {
        return { added: false, reason: 'User is already blacklisted' };
    } else {
        const forumName = extractForumName(forumLink);
        if (!forumName) {
            return { added: false, reason: 'Forum link must be a valid URL with a forum name at the end.' };
        }

        // Add the user to the blacklist
        const state = readBlacklistState();
        state.bl_users.push(user);

        // Create a log entry
        const logEntry = {
            logId: `BL-${Date.now()}`,
            user: user,
            reason: reason,
            length: length,
            ucpLink: ucpLink,
            forumLink: forumLink,
            forumName: forumName,
            interviewer: interviewer || 'Unknown',
            date: getFormattedDate()
        };

        // Push & Save the log entry
        state.logs.push(logEntry);
        state.lastUpdated = logEntry.date;
        writeBlacklistState(state);
        return { added: true, log: logEntry };
    }
}

function removeBlackListUser(user) {
    const exists = isBlacklisted(user);

    if (!exists) {
        return { removed: false, reason: 'User is not blacklisted' };
    } else {
        // Remove the user from the blacklist
        const state = readBlacklistState();
        const normalizedUser = normalizeName(user);
        state.bl_users = state.bl_users.filter(blUser => normalizeName(blUser) !== normalizedUser);
        state.logs = state.logs.filter(log =>
            typeof log?.user !== 'string' || normalizeName(log.user) !== normalizedUser
        );
        state.lastUpdated = getFormattedDate();
        writeBlacklistState(state);
        return { removed: true };
    }
}

function updateBlacklistUser(logId, updates) {
    const forumName = extractForumName(updates.forumLink);
    if (!forumName) {
        return { updated: false, reason: 'Forum link must be a valid URL with a forum name at the end.' };
    }

    const state = readBlacklistState();
    const log = state.logs.find(entry => entry?.logId === logId) ||
        [...state.logs].reverse().find(
            entry => typeof entry?.user === 'string' && normalizeName(entry.user) === normalizeName(logId)
        );
    if (!log || !state.bl_users.some(
        blUser => typeof blUser === 'string' && normalizeName(blUser) === normalizeName(log.user)
    )) {
        return { updated: false, reason: 'No blacklist record was found for this user.' };
    }

    Object.assign(log, {
        reason: updates.reason,
        length: updates.length,
        ucpLink: updates.ucpLink,
        forumLink: updates.forumLink,
        forumName,
        interviewer: updates.interviewer
    });
    state.lastUpdated = getFormattedDate();
    writeBlacklistState(state);
    return { updated: true, log };
}

// Log Retrieval Function

function getUserLogs(user) {
    const state = readBlacklistState();
    const normalizedUser = normalizeName(user);
    const isCurrentlyBlacklisted = state.bl_users.some(
        blUser => typeof blUser === 'string' && normalizeName(blUser) === normalizedUser
    );
    if (!isCurrentlyBlacklisted) return [];

    const logs = Array.isArray(state?.logs) ? state.logs : [];
    return logs.filter(log => typeof log?.user === 'string' && normalizeName(log.user) === normalizedUser);
}

// Container Building/Updating Functions

function buildContainerList(state, requestedPage = 0) {
    const pageSize = 5;
    const pageCount = Math.max(1, Math.ceil(state.bl_users.length / pageSize));
    const page = Math.max(0, Math.min(Number.isInteger(requestedPage) ? requestedPage : 0, pageCount - 1));
    const users = state.bl_users.slice(page * pageSize, (page + 1) * pageSize);
    const container = new ContainerBuilder()
        .setAccentColor(0xFF0000);

    // Title and description
    container.addTextDisplayComponents(
        new TextDisplayBuilder()
            .setContent(`# Blacklisted From Interviews\n\nTotal Blacklisted Users: ${state.bl_users.length}`)
    );

    container.addSeparatorComponents(
        new SeparatorBuilder().setDivider(true)
    );

    if (!state.bl_users.length) {
        container.addTextDisplayComponents(
            new TextDisplayBuilder()
                .setContent('No blacklisted users found.')
        );
    } else {
        // Display each blacklisted user and their logs
        users.forEach((username, index) => {
            const userLogs = getUserLogs(username);
            const latestLog = userLogs[userLogs.length - 1];
            const entryNumber = page * pageSize + index + 1;
            const forumName = latestLog?.forumName || 'N/A';
            const content = `**[${entryNumber.toString().padStart(2, '0')}] ${username} [${forumName}]**`;

            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(content)
            );
        });
    }

    container.addSeparatorComponents(
        new SeparatorBuilder().setDivider(true)
    );

    // Footer
    const latestLog = [...state.logs].reverse().find(log => log.dateOfBl || log.date);
    const lastUpdated = state.lastUpdated || latestLog?.dateOfBl || latestLog?.date || getFormattedDate();
    container.addTextDisplayComponents(
        new TextDisplayBuilder()
            .setContent(`Last Updated: ${lastUpdated}${pageCount > 1 ? ` • Page ${page + 1}/${pageCount}` : ''}`)
    );

    const buttons = [];
    if (state.bl_users.length > pageSize) {
        buttons.push(
            new ButtonBuilder()
                .setCustomId(`blacklist:previous:${page}`)
                .setLabel('Previous')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page === 0),
            new ButtonBuilder()
                .setCustomId(`blacklist:next:${page}`)
                .setLabel('Next')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page === pageCount - 1)
        );
    }

    buttons.push(
        new ButtonBuilder()
            .setCustomId('blacklist:add')
            .setLabel('Add')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId('blacklist:remove')
            .setLabel('Remove')
            .setStyle(ButtonStyle.Danger)
    );

    container.addActionRowComponents(new ActionRowBuilder().addComponents(...buttons));

    return container;
}

function buildContainerListForUser(user) {
    const userLogs = getUserLogs(user);

    // Check if user has logs
    if (!userLogs.length) {
        return new ContainerBuilder()
            .setAccentColor(0xFFE600)
            .addTextDisplayComponents(
                new TextDisplayBuilder()
                    .setContent(`## No logs found for user: ${user}`)
            );
    }

    const container = new ContainerBuilder()
        .setAccentColor(0xFF0000);

    // Header displaying the target user
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`## 📋 Blacklist Record: ${user}\n`)
    );

    container.addSeparatorComponents(
        new SeparatorBuilder().setDivider(true)
    );

    // List all available logs (newest first)
    [...userLogs].reverse().forEach(log => {
        const forumName = log.forumName || extractForumName(log.forumLink) || 'N/A';
        const content = `• **Reason:** ${log.reason || 'N/A'}\n` +
                        `• **Duration:** ${log.length || 'N/A'}\n` +
                        `• **Date of blacklist:** ${log.dateOfBl || log.date || 'N/A'}\n` +
                        `${formatLink('UCP Link', log.ucp || log.ucpLink)}\n` +
                        `${formatLink('Forum Link', log.forumLink, forumName)}`;

        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(content)
        );
    });

    container.addSeparatorComponents(
        new SeparatorBuilder().setDivider(true)
    );

    // Footer
    const logMetadata = [...userLogs].reverse()
        .map(log => `Issuer: ${log.moderator || log.interviewer || 'N/A'} | Log ID: ${log.logId || 'N/A'}`)
        .join(' | ');
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`-# ${logMetadata} | Checked: <t:${Math.floor(Date.now() / 1000)}:R>`)
    );

    return container;
}

async function updateLiveBlacklistEmbed(interaction) {
    const guildId = interaction.guildId;
    const targetChannelId = getGuildBlacklistChannel(guildId);

    if (!targetChannelId) {
        console.error(`[Blacklist] No channels.blacklist found for guild ${guildId}`);
        return null;
    }

    const state = readBlacklistState();
    const container = buildContainerList(state);

    try {
        const channel = await interaction.guild.channels.fetch(targetChannelId);
        if (!channel || !channel.isTextBased()) return null;

        let message = null;

        if (state.embedConfig?.messageId) {
            try {
                message = await channel.messages.fetch(state.embedConfig.messageId);
            } catch {
                message = null;
            }
        }

        if (message) {
            await message.edit({
                components: [container],
                flags: MessageFlags.IsComponentsV2
            });
        } else {
            message = await channel.send({
                components: [container],
                flags: MessageFlags.IsComponentsV2
            });

            state.embedConfig = {
                channelId: targetChannelId,
                messageId: message.id
            };
            writeBlacklistState(state);
        }

        return message;
    } catch (error) {
        console.error('Failed to update live blacklist message:', error);
        return null;
    }
}

// Exporting the functions for use in other modules
module.exports = {
    readBlacklistState,
    normalizeBlacklistState,
    addBlacklistUser,
    removeBlackListUser,
    updateBlacklistUser,
    getUserLogs,
    buildContainerList,
    buildContainerListForUser,
    updateLiveBlacklistEmbed
}