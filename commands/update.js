const fs = require('fs');
const path = require('path');
const { SlashCommandBuilder } = require('discord.js');
require('dotenv').config();

const { getCommandRole, getGuildChannel } = require('../utils/guildConfig');
const { syncInviteRecordsFromDatabase } = require('../utils/performanceLogs');
const { updateLiveBlacklistEmbed } = require('../utils/blacklistLogs');

const statePath = path.join(__dirname, '..', 'invite_logs.json');
const setRankChannelId = process.env.SET_RANK_CHANNEL_ID;

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
}

function readJsonRecord(fileName, defaultValue) {
    const filePath = path.join(__dirname, '..', fileName);
    if (!fs.existsSync(filePath)) {
        return { fileName, filePath, state: defaultValue };
    }

    let state;
    try {
        state = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
        throw new Error(`Cannot normalize ${fileName}; invalid JSON was left untouched: ${error.message}`);
    }

    if (!isRecord(state)) {
        throw new Error(`Cannot normalize ${fileName}; expected a JSON object and left it untouched.`);
    }

    return { fileName, filePath, state };
}

function ensureArrayField(state, fieldName, fileName) {
    if (!hasOwn(state, fieldName)) {
        state[fieldName] = [];
    } else if (!Array.isArray(state[fieldName])) {
        throw new Error(`Cannot normalize ${fileName}; ${fieldName} must be an array and the file was left untouched.`);
    }
}

function normalizeRuntimeJsonFiles() {
    const files = [
        readJsonRecord('guilds.json', {}),
        readJsonRecord('invite_logs.json', { processed: {} }),
        readJsonRecord('blacklist_logs.json', {
            embedConfig: { channelId: null, messageId: null },
            bl_users: [],
            logs: []
        }),
        readJsonRecord('performance_logs.json', { instructors: [], events: [] })
    ];
    const [guilds, inviteState, blacklistState, performanceState] = files;

    if (!hasOwn(inviteState.state, 'processed')) {
        inviteState.state.processed = {};
    } else if (!isRecord(inviteState.state.processed)) {
        throw new Error('Cannot normalize invite_logs.json; processed must be an object and the file was left untouched.');
    }
    for (const entry of Object.values(inviteState.state.processed)) {
        if (!isRecord(entry)) {
            continue;
        }
        if (!hasOwn(entry, 'isSO')) entry.isSO = false;
        if (!hasOwn(entry, 'trainings')) entry.trainings = 'TBD';
        if (!hasOwn(entry, 'ctoExam')) entry.ctoExam = 'TBD';
        if (!hasOwn(entry, 'accountType')) entry.accountType = 'Main';
    }

    ensureArrayField(blacklistState.state, 'bl_users', blacklistState.fileName);
    ensureArrayField(blacklistState.state, 'logs', blacklistState.fileName);
    if (!hasOwn(blacklistState.state, 'embedConfig')) {
        blacklistState.state.embedConfig = {};
    } else if (!isRecord(blacklistState.state.embedConfig)) {
        throw new Error('Cannot normalize blacklist_logs.json; embedConfig must be an object and the file was left untouched.');
    }
    if (!hasOwn(blacklistState.state.embedConfig, 'channelId')) {
        blacklistState.state.embedConfig.channelId = null;
    }
    if (!hasOwn(blacklistState.state.embedConfig, 'messageId')) {
        blacklistState.state.embedConfig.messageId = null;
    }

    ensureArrayField(performanceState.state, 'instructors', performanceState.fileName);
    ensureArrayField(performanceState.state, 'events', performanceState.fileName);

    for (const file of files) {
        fs.writeFileSync(file.filePath, JSON.stringify(file.state, null, 2));
    }

    return files.map(file => file.fileName);
}

function readState() {
    if (!fs.existsSync(statePath)) {
        return { processed: {} };
    }

    try {
        const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        return {
            ...state,
            processed: state && typeof state.processed === 'object' ? state.processed : {}
        };
    } catch (error) {
        throw new Error(`Failed to read invite_logs.json: ${error.message}`);
    }
}

function writeState(state) {
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getCadetNameFromInvite(message) {
    return message?.content.match(/\bname\s*:\s*"([^"]*)"/i)?.[1]?.trim();
}

function isSetRankPost(message, cadetName) {
    const name = escapeRegExp(cadetName.trim());
    return new RegExp(
        `^\\/setrank\\s+${name}(?:\\s+\\[[^\\]]+\\])?\\s+(?:Police Cadet|Police Officer I)\\s*$`,
        'i'
    ).test(message.content.trim());
}

function isAltCadetSetRankPost(message, cadetName) {
    const name = escapeRegExp(cadetName.trim());
    return new RegExp(
        `^\\/setrank\\s+${name}\\s+\\[SO\\]\\s+Police Cadet\\s*$`,
        'i'
    ).test(message.content.trim());
}

async function fetchAllMessages(channel) {
    const messages = new Map();
    let before;

    while (true) {
        const options = { limit: 100 };
        if (before) {
            options.before = before;
        }

        const batch = await channel.messages.fetch(options);
        if (batch.size === 0) {
            break;
        }

        for (const message of batch.values()) {
            messages.set(message.id, message);
        }

        if (batch.size < 100) {
            break;
        }

        const oldestMessage = batch.last();
        if (!oldestMessage) {
            break;
        }
        before = oldestMessage.id;
    }

    return messages;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('update')
        .setDescription('Normalize bot data, refresh the blacklist, and recheck setrank requests'),

    async execute(interaction) {
        const roleId = getCommandRole(interaction.guildId, 'command');
        if (!roleId) {
            return interaction.reply({
                content: 'The Command role has not been configured for this server.',
                ephemeral: true
            });
        }

        if (!interaction.member.roles.cache.has(roleId)) {
            return interaction.reply({
                content: 'You do not have the role required to use `/update`.',
                ephemeral: true
            });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            const normalizedFiles = normalizeRuntimeJsonFiles();
            const performanceSync = syncInviteRecordsFromDatabase();
            const blacklistMessage = await updateLiveBlacklistEmbed(interaction);
            const channelId = getGuildChannel(interaction.guildId, 'setrank', setRankChannelId);
            if (!channelId) {
                return interaction.editReply([
                    `Normalized runtime JSON files without removing records: ${normalizedFiles.join(', ')}.`,
                    `Blacklist message: ${blacklistMessage ? 'refreshed.' : 'not refreshed; check the blacklist channel configuration.'}`,
                    'The setrank request channel is not configured for this server.'
                ].join('\n'));
            }

            const channel = await interaction.client.channels.fetch(channelId);
            if (!channel?.isTextBased() || !channel.messages) {
                return interaction.editReply('The configured setrank request channel is not a text channel.');
            }

            const messages = await fetchAllMessages(channel);
            const state = readState();
            const allEntries = Object.values(state.processed).filter(entry => entry?.messageId);
            const inviteLogsChannelId = getGuildChannel(
                interaction.guildId,
                'inviteLogs',
                process.env.INVITE_LOGS_CHANNEL_ID
            );
            const inviteLogsChannel = inviteLogsChannelId
                ? await interaction.client.channels.fetch(inviteLogsChannelId)
                : null;

            let changed = false;
            let altChecked = 0;
            let verified = 0;
            let posted = 0;
            let missing = 0;

            for (const entry of allEntries) {
                let cadetName = typeof entry.name === 'string' ? entry.name.trim() : '';
                if (!cadetName && inviteLogsChannel?.messages) {
                    const inviteMessage = await inviteLogsChannel.messages.fetch(entry.messageId).catch(() => null);
                    cadetName = getCadetNameFromInvite(inviteMessage) || '';
                }

                if (entry.accountType?.toLowerCase() === 'alt') {
                    altChecked += 1;
                    const isPosted = cadetName.length > 0
                        && [...messages.values()].some(message => isAltCadetSetRankPost(message, cadetName));

                    if (!isPosted) {
                        if (!cadetName) {
                            missing += 1;
                            continue;
                        }

                        await channel.send(`/setrank ${cadetName} [SO] Police Cadet`);
                        messages.set(`new-${entry.messageId}`, { content: `/setrank ${cadetName} [SO] Police Cadet` });
                        posted += 1;
                    } else {
                        verified += 1;
                    }

                    if (entry.isSO !== true) {
                        entry.isSO = true;
                        changed = true;
                    }
                    continue;
                }

                if (entry.isSO !== true) {
                    continue;
                }

                const isPosted = cadetName.length > 0
                    && [...messages.values()].some(message => isSetRankPost(message, cadetName));
                if (!isPosted) {
                    entry.isSO = false;
                    changed = true;
                    missing += 1;
                } else {
                    verified += 1;
                }
            }

            if (changed) {
                writeState(state);
            }

            return interaction.editReply([
                `Normalized runtime JSON files without removing records: ${normalizedFiles.join(', ')}.`,
                `Blacklist message: ${blacklistMessage ? 'refreshed.' : 'not refreshed; check the blacklist channel configuration.'}`,
                `Historical instructor invite logs imported: **${performanceSync.imported}**.`,
                `Alt records checked: **${altChecked}**.`,
                `Setrank posts verified: **${verified}**.`,
                `Setrank posts created: **${posted}**.`,
                `Setrank posts missing: **${missing}**.`,
                changed ? 'Updated `isSO` values in `invite_logs.json`.' : 'All `isSO` values were already correct.'
            ].join('\n'));
        } catch (error) {
            console.error('Failed to update invite records:', error);
            return interaction.editReply(`Failed to update invite records: ${error.message}`);
        }
    }
};
