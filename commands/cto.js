const { SlashCommandBuilder } = require('discord.js');
const { getCommandRole } = require('../utils/guildConfig');
const {
    readState,
    writeState,
    buildInvitePost,
    buildCtoNotice,
    formatStatusDate,
    sendSetRankMessage,
    closePassedCtoThread
} = require('./cadets');

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
            .setRequired(true))
        .addStringOption(opt => opt
            .setName('rank')
            .setDescription('Testing Officer rank')
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
        const roleId = getCommandRole(interaction.guildId, 'cto');
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
        const rank = interaction.options.getString('rank').trim();
        const badge = interaction.options.getString('badge')?.trim();
        const result = interaction.options.getString('result');

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
            const notice = buildCtoNotice(toName, rank, badge, result);
            await thread.send({ content: notice });

            entry.ctoExam = `${result} (${formatStatusDate()})`;
            entry.ctoResult = result;

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
                state.processed[entry.messageId] = { messageId: entry.messageId, isSO: true };
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
        const roleId = getCommandRole(interaction.guildId, 'cto');
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
    }
};
