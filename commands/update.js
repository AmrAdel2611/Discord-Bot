const fs = require('fs');
const path = require('path');
const { SlashCommandBuilder } = require('discord.js');
require('dotenv').config();

const { getCommandRole, getGuildChannel } = require('../utils/guildConfig');
const { syncInviteRecordsFromDatabase } = require('../utils/performanceLogs');

const statePath = path.join(__dirname, '..', 'invite_logs.json');
const setRankChannelId = process.env.SET_RANK_CHANNEL_ID;

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
        .setDescription('Recheck invite records and setrank requests'),

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
            const performanceSync = syncInviteRecordsFromDatabase();
            const channelId = getGuildChannel(interaction.guildId, 'setrank', setRankChannelId);
            if (!channelId) {
                return interaction.editReply('The setrank request channel is not configured for this server.');
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
