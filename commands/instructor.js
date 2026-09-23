const { SlashCommandBuilder } = require('discord.js');
const { getCommandRole } = require('../utils/guildConfig');
const {
    addInstructor,
    getInstructorChoices,
    removeInstructor
} = require('../utils/performanceLogs');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('instructor')
        .setDescription('Manage the Training Officer roster')
        .addSubcommand(subcommand => subcommand
            .setName('add')
            .setDescription('Add an instructor to the roster')
            .addStringOption(option => option
                .setName('ig_name')
                .setDescription('In-game instructor name')
                .setRequired(true)))
        .addSubcommand(subcommand => subcommand
            .setName('remove')
            .setDescription('Remove an instructor from the roster')
            .addStringOption(option => option
                .setName('ig_name')
                .setDescription('In-game instructor name')
                .setAutocomplete(true)
                .setRequired(true))),

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
                content: 'You do not have the role required to use `/instructor`.',
                ephemeral: true
            });
        }

        const name = interaction.options.getString('ig_name').trim();
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'add') {
            const result = addInstructor(name);
            return interaction.reply({
                content: result.added
                    ? `Added **${name}** to the instructor roster.`
                    : `**${name}** is already on the instructor roster.`,
                ephemeral: true
            });
        }

        const result = removeInstructor(name);
        return interaction.reply({
            content: result.removed
                ? `Removed **${name}** from the instructor roster.`
                : `Could not find **${name}** on the instructor roster.`,
            ephemeral: true
        });
    },

    async autocomplete(interaction) {
        const roleId = getCommandRole(interaction.guildId, 'command');
        if (!roleId || !interaction.member.roles.cache.has(roleId)) {
            return interaction.respond([]);
        }

        await interaction.respond(
            getInstructorChoices(interaction.options.getFocused())
        );
    }
};
