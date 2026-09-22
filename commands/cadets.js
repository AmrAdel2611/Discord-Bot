const fs = require('fs');
const path = require('path');
const { SlashCommandBuilder } = require('discord.js');
require('dotenv').config();

const { getCommandRole, getGuildChannel } = require('../utils/guildConfig');

const statePath = path.join(__dirname, '..', 'invite_logs.json');
const sourceChannelId = process.env.INVITE_LOGS_CHANNEL_ID;
const outputChannelId = process.env.post_channel;
const setRankChannelId = process.env.SET_RANK_CHANNEL_ID;

function readState() {
    if (!fs.existsSync(statePath)) {
        return { processed: {} };
    }

    try {
        const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        const normalizedState = {
            ...state,
            processed: state && typeof state.processed === 'object' ? state.processed : {}
        };

        let changed = false;
        for (const entry of Object.values(normalizedState.processed)) {
            if (typeof entry.isSO !== 'boolean') {
                entry.isSO = false;
                changed = true;
            }

            if (Object.keys(entry).length === 1 && entry.messageId) {
                continue;
            }

            if (!entry.trainings) {
                entry.trainings = 'TBD';
                changed = true;
            }
            if (!entry.ctoExam) {
                entry.ctoExam = 'TBD';
                changed = true;
            }
            if (!entry.accountType) {
                entry.accountType = 'Main';
                changed = true;
            }
        }

        if (changed) {
            writeState(normalizedState);
        }

        return normalizedState;
    } catch (error) {
        console.error('Failed to read invite log state:', error.message);
        return { processed: {} };
    }
}

function writeState(state) {
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

function parseInviteLog(message) {
    const nameMatch = message.content.match(/\bname\s*:\s*"([^"]*)"/i);
    const invitedByMatch = message.content.match(/\binvited_by\s*:\s*"([^"]*)"/i);
    const timestampMatch = message.content.match(/\btimestamp\s*:\s*"([^"]*)"/i);

    if (!nameMatch || !invitedByMatch || !timestampMatch) {
        return null;
    }

    const date = new Date(timestampMatch[1]);
    if (Number.isNaN(date.getTime())) {
        return null;
    }

    const formattedDate = date.toISOString().split('T')[0].split('-').reverse().join('.');
    return {
        messageId: message.id,
        name: nameMatch[1].trim(),
        invitedBy: invitedByMatch[1].trim(),
        date: formattedDate,
        accountType: 'Main',
        isSO: false,
        trainings: 'TBD',
        ctoExam: 'TBD'
    };
}

function buildInvitePost(invite) {
    return [
        `Date of Invite: ${invite.date}`,
        `Invited By: ${invite.invitedBy}`,
        `PR: ${invite.pr || 'TBA'}`,
        `Main or Alt: ${invite.accountType || ''}`,
        `If alt, main: ${invite.mainUcp || (invite.accountType === 'Main' ? invite.ucp || '' : '')}`,
        `Trainings: ${invite.trainings || 'None'}`,
        `CTO Exam: ${invite.ctoExam || 'TBD'}`
    ].join('\n');
}

async function sendAltCadetSetRankMessage(client, guildId, cadetName) {
    const channelId = getGuildChannel(guildId, 'setrank', setRankChannelId);
    if (!channelId) {
        throw new Error('SET_RANK_CHANNEL_ID is not configured in .env.');
    }

    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased()) {
        throw new Error('SET_RANK_CHANNEL_ID must point to a text channel.');
    }

    await channel.send(`/setrank ${cadetName} [SO] Police Cadet`);
}

function buildRecordNotice({ coName, rank, personalNote }) {
    const now = new Date();
    const formattedDate = `${now.getUTCDate()}.${now.getUTCMonth() + 1}.${now.getUTCFullYear()}`;

    return [
        '```ansi',
        '\u001b[0;33mRecord Notice\u001b[0m',
        `\u001b[1mCO name:\u001b[0m ${coName}`,
        `\u001b[1mRank:\u001b[0m ${rank}`,
        `\u001b[1mDate:\u001b[0m ${formattedDate}`,
        '',
        '\u001b[1mPERSONAL:\u001b[0m',
        personalNote,
        '```'
    ].join('\n');
}

async function postInvite(client, guildId, invite) {
    const channelId = getGuildChannel(guildId, 'forum', outputChannelId);
    const outputChannel = await client.channels.fetch(channelId);
    if (!outputChannel?.isThreadOnly()) {
        throw new Error('post_channel must be a Discord forum channel');
    }

    const threadName = `CADET | ${invite.name}`.slice(0, 100);
    const thread = await outputChannel.threads.create({
        name: threadName,
        message: { content: buildInvitePost(invite) }
    });

    invite.threadId = thread.id;
    return thread;
}

async function processInviteMessage(message, client) {
    const configuredSourceChannelId = getGuildChannel(message.guildId, 'inviteLogs', sourceChannelId);
    if (message.channel.id !== configuredSourceChannelId) {
        return false;
    }

    const invite = parseInviteLog(message);
    if (!invite) {
        return false;
    }

    const state = readState();
    if (state.processed[invite.messageId]) {
        return false;
    }

    await postInvite(client, message.guildId, invite);
    state.processed[invite.messageId] = invite;
    writeState(state);
    return true;
}

async function refreshInviteLogs(interaction) {
    const configuredSourceChannelId = getGuildChannel(interaction.guildId, 'inviteLogs', sourceChannelId);
    const configuredOutputChannelId = getGuildChannel(interaction.guildId, 'forum', outputChannelId);
    if (!configuredSourceChannelId || !configuredOutputChannelId) {
        return interaction.reply({
            content: 'Invite log and forum channels are not configured for this server.',
            ephemeral: true
        });
    }

    await interaction.deferReply({ ephemeral: true });
    const state = readState();
    const sourceChannel = await interaction.client.channels.fetch(configuredSourceChannelId);
    const messages = await sourceChannel.messages.fetch({ limit: 10 });
    const newInvites = [];

    for (const message of messages.values()) {
        const invite = parseInviteLog(message);
        if (!invite || state.processed[invite.messageId]) {
            continue;
        }

        await postInvite(interaction.client, interaction.guildId, invite);
        state.processed[invite.messageId] = invite;
        newInvites.push(invite);
    }

    writeState(state);
    return interaction.editReply(
        newInvites.length > 0
            ? `Posted ${newInvites.length} new invite log${newInvites.length === 1 ? '' : 's'}.`
            : 'No new invite logs found in the last 10 messages.'
    );
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('cadets')
        .setDescription('Manage cadet records and logs')
        // /cadets edit
        .addSubcommand(subcommand => subcommand
            .setName('edit')
            .setDescription('Edit cadet forum post information')
            .addStringOption(opt => opt
                .setName('name')
                .setDescription('Exact in-game cadet name')
                .setAutocomplete(true)
                .setRequired(true))
            .addStringOption(opt => opt
                .setName('rank')
                .setDescription('Your rank (e.g., PO III)')
                .setRequired(false))
            .addStringOption(opt => opt
                .setName('account_type')
                .setDescription('Account classification')
                .setRequired(false)
                .addChoices(
                    { name: 'Alt', value: 'Alt' }
                ))
            .addStringOption(opt => opt
                .setName('pr')
                .setDescription('Personnel Record (PR) forum link')
                .setRequired(false))
            .addStringOption(opt => opt
                .setName('ucp')
                .setDescription('Main account UCP link (if Alt) or cadet UCP link')
                .setRequired(false))),

    async execute(interaction) {
        const roleId = getCommandRole(interaction.guildId, 'cadets');
        if (!roleId) {
            return interaction.reply({
                content: 'The `/cadets` command has not been configured for this server.',
                ephemeral: true
            });
        }

        if (!interaction.member.roles.cache.has(roleId)) {
            return interaction.reply({
                content: 'You do not have the role required to use `/cadets`.',
                ephemeral: true
            });
        }

        const sub = interaction.options.getSubcommand();
        const state = readState();

        // EDIT
        if (sub === 'edit') {
            await interaction.deferReply({ ephemeral: true });

            const targetName = interaction.options.getString('name').trim().toLowerCase();
            const rank = interaction.options.getString('rank')?.trim() || '';
            const accountType = interaction.options.getString('account_type');
            const pr = interaction.options.getString('pr')?.trim();
            const ucp = interaction.options.getString('ucp')?.trim();

            if (!accountType && !pr && !ucp) {
                return interaction.editReply('You must provide at least one field to update (`pr`, `account_type`, or `ucp`).');
            }

            const entry = Object.values(state.processed).find(
                item => typeof item.name === 'string' && item.name.toLowerCase() === targetName
            );

            if (!entry || !entry.threadId) {
                return interaction.editReply(`Could not find a forum post for cadet: **${targetName}**.`);
            }

            try {
                const thread = await interaction.client.channels.fetch(entry.threadId);
                const notes = [];

                if (pr !== undefined) {
                    entry.pr = pr;
                    notes.push(`Cadet has made his Personnel Record [${pr}]`);
                }

                if (accountType) {
                    entry.accountType = accountType;
                }

                if (ucp !== undefined) {
                    const currentType = entry.accountType || accountType;
                    if (currentType === 'Alt') {
                        entry.mainUcp = ucp;
                        notes.push(`Cadet marked as Alt account. Main UCP: [${ucp}]`);
                    } else {
                        entry.ucp = ucp;
                        entry.mainUcp = '';
                        notes.push(`Cadet account profile linked: [${ucp}]`);
                    }
                }

                const starterMessage = await thread.messages.fetch(thread.id);
                await starterMessage.edit({ content: buildInvitePost(entry) });
                writeState(state);

                if (notes.length > 0) {
                    const noticeText = buildRecordNotice({
                        coName: interaction.member?.displayName || interaction.user.username,
                        rank: rank,
                        personalNote: notes.join('\n')
                    });
                    await thread.send({ content: noticeText });
                }

                if (accountType?.toLowerCase() === 'alt') {
                    await sendAltCadetSetRankMessage(
                        interaction.client,
                        interaction.guildId,
                        entry.name
                    );
                    entry.isSO = true;
                    writeState(state);
                }

                return interaction.editReply(
                    accountType?.toLowerCase() === 'alt'
                        ? `Successfully updated forum post for **${entry.name}** and sent the Police Cadet setrank request.`
                        : `Successfully updated forum post for **${entry.name}**.`
                );
            } catch (error) {
                console.error('Failed to update forum post:', error);
                return interaction.editReply(`Error updating forum post: ${error.message}`);
            }
        }
    },

    async autocomplete(interaction) {
        const roleId = getCommandRole(interaction.guildId, 'cadets');
        if (!roleId || !interaction.member.roles.cache.has(roleId)) {
            return interaction.respond([]);
        }

        const focusedValue = interaction.options.getFocused().toLowerCase();
        const seenNames = new Set();
        const choices = Object.values(readState().processed)
            .filter(entry => entry.threadId && entry.name)
            .filter(entry => entry.name.toLowerCase().includes(focusedValue))
            .filter(entry => {
                const normalizedName = entry.name.toLowerCase();
                if (seenNames.has(normalizedName)) {
                    return false;
                }
                seenNames.add(normalizedName);
                return true;
            })
            .slice(0, 25)
            .map(entry => ({ name: entry.name, value: entry.name }));

        await interaction.respond(choices);
    },

    processInviteMessage,
    refreshInviteLogs,
    readState,
    writeState,
    buildInvitePost,
    sendAltCadetSetRankMessage
};