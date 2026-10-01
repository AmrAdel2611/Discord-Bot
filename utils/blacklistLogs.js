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

function addBlacklistUser(user, reason, length, ucpLink, interviewer) {
    const alreadyExists = isBlacklisted(user);

    if (alreadyExists) {
        return { added: false, reason: 'User is already blacklisted' };
    } else {
        // Add the user to the blacklist
        const state = readBlacklistState();
        state.bl_users.push(user);

        // Create a log entry
        const logEntry = {
            logId: `BL-${Date.now().toString(36).toUpperCase()}`, // Unique log ID based on timestamp
            user: user,
            reason: reason,
            length: length,
            ucpLink: ucpLink,
            interviewer: interviewer || 'Unknown',
            date: getFormattedDate()
        };

        // Push & Save the log entry
        state.logs.push(logEntry);
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
        state.bl_users = state.bl_users.filter(blUser => normalizeName(blUser) !== normalizeName(user));
        writeBlacklistState(state);
        return { removed: true };
    }
}

// Log Retrieval Function

function getUserLogs(user) {
    const state = readBlacklistState();
    const normalizedUser = normalizeName(user);
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
            let content = `### [**${entryNumber.toString().padStart(2, '0')}] ${username}**\n`;

            if (latestLog) {
                content += '• **Duration:** ' + latestLog.length + ' | ';
                content += '**Date:** ' + (latestLog.dateOfBl || latestLog.date || 'N/A') + '\n';
                content += '• **Reason:** ' + latestLog.reason + '\n';
                content += '• **UCP Link:** ' + (latestLog.ucp || latestLog.ucpLink || 'N/A');
            } else {
                content += '• No logs available for this user.\n';
            }

            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(content)
            );
        });
    }

    container.addSeparatorComponents(
        new SeparatorBuilder().setDivider(true)
    );

    // Footer
    container.addTextDisplayComponents(
        new TextDisplayBuilder()
            .setContent(`Last Updated: ${getFormattedDate()}${pageCount > 1 ? ` • Page ${page + 1}/${pageCount}` : ''}`)
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
                    .setContent(`No logs found for user: ${user}`)
            );
    }

    const container = new ContainerBuilder()
        .setAccentColor(0xFF0000);

    // Header displaying the target user
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`# 📋 Blacklist Record: ${user}\n`)
    );

    container.addSeparatorComponents(
        new SeparatorBuilder().setDivider(true)
    );

    // List all available logs (newest first)
    [...userLogs].reverse().forEach((log, index) => {
        const content = `### [**LogId: ${log.logId}]**\n` +
                        `• **Issued By:** ${log.moderator || log.interviewer || 'N/A'}\n` +
                        `• **Duration:** ${log.length} | **Date:** ${log.dateOfBl || log.date || 'N/A'}\n` +
                        `• **Reason:** ${log.reason}\n` +
                        `• **UCP Link:** ${log.ucp || log.ucpLink || 'N/A'}\n`;

        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(content)
        );
    });

    container.addSeparatorComponents(
        new SeparatorBuilder().setDivider(true)
    );

    // Footer
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`-# Target: ${user} • Checked: <t:${Math.floor(Date.now() / 1000)}:R>`)
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
    getUserLogs,
    buildContainerList,
    buildContainerListForUser,
    updateLiveBlacklistEmbed
}