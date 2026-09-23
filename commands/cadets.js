const { SlashCommandBuilder } = require('discord.js');
require('dotenv').config();

const { getCommandRole, getGuildChannel } = require('../utils/guildConfig');
const setRankChannelId = process.env.SET_RANK_CHANNEL_ID;

const {
    buildInvitePost,
    readState,
    writeState
} = require('../utils/cadetRecords');

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
        const roleId = getCommandRole(interaction.guildId, 'training_officer');
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
        const roleId = getCommandRole(interaction.guildId, 'training_officer');
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

    readState,
    writeState,
    sendAltCadetSetRankMessage
};