const fs = require('fs');
const path = require('path');
require('dotenv').config();

const { getGuildChannel } = require('./guildConfig');
const { recordInvite } = require('./performanceLogs');

const statePath = path.join(__dirname, '..', 'invite_logs.json');
const sourceChannelId = process.env.INVITE_LOGS_CHANNEL_ID;
const outputChannelId = process.env.post_channel;

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
    const content = [
        message.content,
        ...(message.embeds || []).flatMap(embed => [embed.title, embed.description]),
        ...(message.embeds || []).flatMap(embed => (embed.fields || []).map(field => `${field.name}: ${field.value}`))
    ].filter(Boolean).join('\n');
    const nameMatch = content.match(/\bname\s*:\s*"?([^"\r\n]+)"?/i);
    const invitedByMatch = content.match(/\binvited_by\s*:\s*"?([^"\r\n]+)"?/i);
    const timestampMatch = content.match(/\btimestamp\s*:\s*"?([^"\r\n]+)"?/i);

    if (!nameMatch || !invitedByMatch || !timestampMatch) {
        return null;
    }

    const date = new Date(timestampMatch[1]);
    if (Number.isNaN(date.getTime())) {
        return null;
    }

    return {
        messageId: message.id,
        name: nameMatch[1].trim(),
        invitedBy: invitedByMatch[1].trim(),
        date: date.toISOString().split('T')[0].split('-').reverse().join('.'),
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

async function postInvite(client, guildId, invite) {
    const channelId = getGuildChannel(guildId, 'forum', outputChannelId);
    if (!channelId) {
        throw new Error('Forum channel is not configured.');
    }

    const outputChannel = await client.channels.fetch(channelId);
    if (!outputChannel?.isThreadOnly()) {
        throw new Error('The configured forum channel must be a Discord forum channel.');
    }

    const thread = await outputChannel.threads.create({
        name: `CADET | ${invite.name}`.slice(0, 100),
        message: { content: buildInvitePost(invite) }
    });

    invite.threadId = thread.id;
    return thread;
}

async function processInviteMessage(message, client) {
    const configuredSourceChannelId = getGuildChannel(message.guildId, 'inviteLogs', sourceChannelId);
    if (!configuredSourceChannelId || message.channel.id !== configuredSourceChannelId) {
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
    recordInvite(invite);
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
    const messages = await sourceChannel.messages.fetch({ limit: 100 });
    const newInvites = [];
    let parsedInvites = 0;
    let alreadyImported = 0;
    let contentMessages = 0;
    let firstPreview = '';

    for (const message of messages.values()) {
        const content = message.content || message.embeds?.[0]?.description || '';
        if (content) {
            contentMessages += 1;
            if (!firstPreview) {
                firstPreview = content.replace(/\s+/g, ' ').slice(0, 120);
            }
        }

        const invite = parseInviteLog(message);
        if (!invite) {
            continue;
        }

        parsedInvites += 1;
        if (state.processed[invite.messageId]) {
            alreadyImported += 1;
            continue;
        }

        await postInvite(interaction.client, interaction.guildId, invite);
        state.processed[invite.messageId] = invite;
        recordInvite(invite);
        newInvites.push(invite);
    }

    writeState(state);
    return interaction.editReply(
        newInvites.length > 0
            ? `Posted ${newInvites.length} new invite log${newInvites.length === 1 ? '' : 's'}.`
            : `No new invite logs found in the last 100 messages in <#${configuredSourceChannelId}>. Scanned ${messages.size}; readable ${contentMessages}; parsed ${parsedInvites}; already imported ${alreadyImported}. Preview: ${firstPreview || '[empty content]'}`
    );
}

module.exports = {
    buildInvitePost,
    parseInviteLog,
    postInvite,
    processInviteMessage,
    readState,
    refreshInviteLogs,
    writeState
};
