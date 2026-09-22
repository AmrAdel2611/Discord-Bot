const { SlashCommandBuilder } = require('discord.js');
const { getCommandRole } = require('../utils/guildConfig');
const {
    readState,
    writeState,
    buildTrainingNotice,
    buildInvitePost
} = require('./cadets');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('training')
        .setDescription('Post a training completion review into the cadet thread')
        .addStringOption(opt => opt
            .setName('cadet_name')
            .setDescription('Exact name of the cadet')
            .setAutocomplete(true)
            .setRequired(true))
        .addStringOption(opt => opt
            .setName('to_name')
            .setDescription('Training Officer name')
            .setRequired(true))
        .addStringOption(opt => opt
            .setName('rank')
            .setDescription('Training Officer rank (e.g., PO III, Sergeant)')
            .setRequired(true))
        .addStringOption(opt => opt
            .setName('custom_trainings')
            .setDescription('Optional custom trainings separated by commas (e.g., X, Y)')
            .setRequired(false)),

    async execute(interaction) {
        const roleId = getCommandRole(interaction.guildId, 'training');
        if (!roleId) {
            return interaction.reply({
                content: 'The `/training` command has not been configured for this server.',
                ephemeral: true
            });
        }

        if (!interaction.member.roles.cache.has(roleId)) {
            return interaction.reply({
                content: 'You do not have the role required to use `/training`.',
                ephemeral: true
            });
        }

        await interaction.deferReply({ ephemeral: true });
        const cadetName = interaction.options.getString('cadet_name').trim().toLowerCase();
        const toName = interaction.options.getString('to_name').trim();
        const rank = interaction.options.getString('rank').trim();
        const customTrainings = interaction.options.getString('custom_trainings') || '';
        const state = readState();
        const entry = Object.values(state.processed).find(
            item => typeof item.name === 'string' && item.name.toLowerCase() === cadetName
        );

        if (!entry || !entry.threadId) {
            return interaction.editReply(`Could not find a valid forum thread for cadet: **${cadetName}**.`);
        }

        try {
            const thread = await interaction.client.channels.fetch(entry.threadId);
            const notice = buildTrainingNotice(toName, rank, customTrainings);
            await thread.send({ content: notice });
            entry.trainings = 'Done';
            const starterMessage = await thread.fetchStarterMessage();
            await starterMessage.edit({ content: buildInvitePost(entry) });
            writeState(state);
            return interaction.editReply(`Successfully posted training log for **${entry.name}**.`);
        } catch (err) {
            console.error(err);
            return interaction.editReply(`Failed to post training notice: ${err.message}`);
        }
    },

    async autocomplete(interaction) {
        const roleId = getCommandRole(interaction.guildId, 'training');
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
