const { SlashCommandBuilder } = require('discord.js');
require('dotenv').config();

const { getCommandRole, getGuildChannel } = require('../utils/guildConfig');
const {
    buildInvitePost,
    readState,
    writeState
} = require('../utils/cadetRecords');
const {
    getInstructor,
    getInstructorChoices,
    recordCto
} = require('../utils/performanceLogs');

const setRankChannelId = process.env.SET_RANK_CHANNEL_ID;

function formatStatusDate() {
    const now = new Date();
    return `${String(now.getUTCDate()).padStart(2, '0')}.${String(now.getUTCMonth() + 1).padStart(2, '0')}.${now.getUTCFullYear()}`;
}

function formatServiceNumber(badge, accountType) {
    const serviceNumber = badge.trim();
    if (accountType !== 'Alt') {
        return serviceNumber.replace(/^SO-/i, '');
    }

    return serviceNumber.toUpperCase().startsWith('SO-')
        ? serviceNumber
        : `SO-${serviceNumber}`;
}

async function sendSetRankMessage(client, guildId, cadetName, rank, serviceNumber = '', accountType) {
    const channelId = getGuildChannel(guildId, 'setrank', setRankChannelId);
    if (!channelId) {
        throw new Error('SET_RANK_CHANNEL_ID is not configured in .env.');
    }

    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased()) {
        throw new Error('SET_RANK_CHANNEL_ID must point to a text channel.');
    }

    const badgePart = serviceNumber ? ` [${formatServiceNumber(serviceNumber, accountType)}]` : '';
    await channel.send(`/setrank ${cadetName}${badgePart} ${rank}`);
}

function buildCtoNotice(toName, badge, result) {
    const now = new Date();
    const day = String(now.getUTCDate()).padStart(2, '0');
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const year = now.getUTCFullYear();
    const dateFormatted = `${day}-${month}-${year}`;

    if (result === 'Passed') {
        return [
            '```ansi',
            '\u001b[2;32mPerformance review\u001b[0m',
            `\u001b[1;2mCO name: ${toName}`,
            'Rank: Training Officer',
            `Date: ${dateFormatted}\u001b[0m`,
            '',
            'The results of the performance review:',
            'AUTOMATED: This employee has been performing above what is expected. The employee has been noted positively and is developing his skills as required.',
            '',
            'The employee passed his officer test and therefore is considered above average.',
            '',
            'PERSONAL:',
            `Promoted to Police Officer I, service number "${badge}"; assigned!`,
            '```'
        ].join('\n');
    }

    return [
        '```ansi',
        '\u001b[2;31mPerformance review\u001b[0m',
        `\u001b[1;2mCO name: ${toName}`,
        'Rank: Training Officer',
        `Date: ${dateFormatted}\u001b[0m`,
        '',
        'The results of the performance review:',
        'AUTOMATED: This employee has not demonstrated sufficient comprehension of operational procedures. Additional guidance is required.',
        '',
        'The employee failed his officer test and is currently marked as needing improvement.',
        '',
        'PERSONAL:',
        'Cadet failed the CTO evaluation. Re-evaluation required under supervising officer.',
        '```'
    ].join('\n');
}

async function closePassedCtoThread(thread) {
    const passedTitle = thread.name.startsWith('{PASSED}')
        ? thread.name
        : `{PASSED} ${thread.name}`.slice(0, 100);

    await thread.setName(passedTitle);
    await thread.setArchived(true);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('cto')
        .setDescription('Post a CTO Exam performance review')
        .addStringOption(opt => opt
            .setName('cadet_name')
            .setDescription('Exact name of the cadet')
            .setAutocomplete(true)
            .setRequired(true))
        .addStringOption(opt => opt
            .setName('to_name')
            .setDescription('Testing Officer name')
            .setAutocomplete(true)
            .setRequired(true))
        .addStringOption(opt => opt
            .setName('result')
            .setDescription('Exam result')
            .setRequired(true)
            .addChoices(
                { name: 'Passed', value: 'Passed' },
                { name: 'Failed', value: 'Failed' }
            ))
        .addStringOption(opt => opt
            .setName('badge')
            .setDescription('Assigned Badge / Service Number (if passed)')
            .setRequired(false)),

    async execute(interaction) {
        const roleId = getCommandRole(interaction.guildId, 'training_officer');
        if (!roleId) {
            return interaction.reply({
                content: 'The `/cto` command has not been configured for this server.',
                ephemeral: true
            });
        }

        if (!interaction.member.roles.cache.has(roleId)) {
            return interaction.reply({
                content: 'You do not have the role required to use `/cto`.',
                ephemeral: true
            });
        }

        const cadetName = interaction.options.getString('cadet_name').trim().toLowerCase();
        const toName = interaction.options.getString('to_name').trim();
        const badge = interaction.options.getString('badge')?.trim();
        const result = interaction.options.getString('result');

        if (!getInstructor(toName)) {
            return interaction.reply({
                content: `**${toName}** is not on the instructor roster. Use \`/instructor add\` first.`,
                ephemeral: true
            });
        }

        if (result === 'Passed' && !badge) {
            return interaction.reply({
                content: 'You must provide a badge/service number when marking a cadet as **Passed**.',
                ephemeral: true
            });
        }

        await interaction.deferReply({ ephemeral: true });
        const state = readState();
        const entry = Object.values(state.processed).find(
            item => typeof item.name === 'string' && item.name.toLowerCase() === cadetName
        );

        if (!entry || !entry.threadId) {
            return interaction.editReply(`Could not find a valid forum thread for cadet: **${cadetName}**.`);
        }

        try {
            const thread = await interaction.client.channels.fetch(entry.threadId);
            const notice = buildCtoNotice(toName, badge, result);
            await thread.send({ content: notice });

            entry.ctoExam = `${result} (${formatStatusDate()})`;
            entry.ctoResult = result;
            entry.ctoOfficer = toName;
            recordCto(entry, toName, result);

            if (result === 'Passed') {
                entry.closed = true;
            }

            const starterMessage = await thread.messages.fetch(thread.id);
            await starterMessage.edit({ content: buildInvitePost(entry) });
            writeState(state);

            if (result === 'Passed') {
                await sendSetRankMessage(
                    interaction.client,
                    interaction.guildId,
                    entry.name,
                    'Police Officer I',
                    badge,
                    entry.accountType
                );
                entry.isSO = true;
                writeState(state);
                await closePassedCtoThread(thread);

                return interaction.editReply(
                    `Successfully posted CTO result (Passed), sent the promotion command for badge **${badge}**, and closed the post.`
                );
            }

            return interaction.editReply(`Successfully posted CTO result (${result}) for **${entry.name}**.`);
        } catch (err) {
            console.error(err);
            return interaction.editReply(`Failed to post CTO review: ${err.message}`);
        }
    },

    async autocomplete(interaction) {
        const roleId = getCommandRole(interaction.guildId, 'training_officer');
        if (!roleId || !interaction.member.roles.cache.has(roleId)) {
            return interaction.respond([]);
        }

        const focusedValue = interaction.options.getFocused().toLowerCase();
        if (interaction.options.getFocused(true).name === 'to_name') {
            return interaction.respond(getInstructorChoices(focusedValue));
        }

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
    }
};
