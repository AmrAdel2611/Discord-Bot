const fs = require('fs');
const path = require('path');
const { 
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

function normalizeState(state) {
    const bl_users = Array.isArray(state?.bl_users) ? state.bl_users : [];
    const validUsers = new Set(bl_users.map(user => normalizeName(user)));

    return {
        embedConfig: {
            channelId: state?.embedConfig?.channelId || null,
            messageId: state?.embedConfig?.messageId || null
        },
        bl_users,
        logs: (Array.isArray(state?.logs) ? state.logs : []).filter(
            log => log?.user && validUsers.has(normalizeName(log.user))
        ),
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
        const state = normalizeState(JSON.parse(fs.readFileSync(statePath, 'utf8')));
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
        const cleanState = normalizeState(state);
        
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
    return logs.filter(log => normalizeName(log.user) === normalizedUser);
}

// Container Building/Updating Functions

function buildContainerList(state) {
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
        state.bl_users.forEach((username, index) => {
            const userLogs = getUserLogs(username);
            const latestLog = userLogs[userLogs.length - 1];
            let content = `### [**${(index + 1).toString().padStart(2, '0')}] ${username}**\n`;

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
            .setContent(`Last Updated: ${getFormattedDate()}, use \`/blacklist [add/remove]\` to manage entries.`)
    );

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
    addBlacklistUser,
    removeBlackListUser,
    getUserLogs,
    buildContainerListForUser,
    updateLiveBlacklistEmbed
}