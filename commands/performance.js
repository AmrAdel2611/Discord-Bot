const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
require('dotenv').config();

const { getCommandRole } = require('../utils/guildConfig');
const { readState: readCadetState } = require('../utils/cadetRecords');
const { syncInviteRecords } = require('../utils/performanceLogs');

function buildPerformanceReport(state) {
    const officers = new Map();

    for (const instructor of state.instructors) {
        officers.set(instructor.toLowerCase(), {
            name: instructor,
            invites: 0,
            ctoPasses: 0
        });
    }

    for (const event of state.events) {
        if (!event.instructor) {
            continue;
        }

        const officer = officers.get(event.instructor.trim().toLowerCase());
        if (!officer) {
            continue;
        }

        if (event.type === 'invite') {
            officer.invites += 1;
        }

        if (event.type === 'cto' && event.result === 'Passed') {
            officer.ctoPasses += 1;
        }
    }

    return [...officers.values()]
        .sort((left, right) => right.invites - left.invites || right.ctoPasses - left.ctoPasses || left.name.localeCompare(right.name));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('performance')
        .setDescription('View performance information of all Training Officers.'),

    async execute(interaction) {
        const roleId = getCommandRole(interaction.guildId, 'training_officer');
        if (!roleId) {
            return interaction.reply({
                content: 'The `/performance` command has not been configured for this server.',
                ephemeral: true
            });
        }

        if (!interaction.member.roles.cache.has(roleId)) {
            return interaction.reply({
                content: 'You do not have the role required to use `/performance`.',
                ephemeral: true
            });
        }

        const cadetState = readCadetState();
        const performanceState = syncInviteRecords(Object.values(cadetState.processed));
        const officers = buildPerformanceReport(performanceState);

        if (officers.length === 0) {
            return interaction.reply({
                embeds: [new EmbedBuilder()
                    .setTitle('Training Officer Performance')
                    .setDescription('No Training Officer performance records found.')
                    .setColor(0x3498db)]
            });
        }

        const embeds = [];
        for (let index = 0; index < officers.length; index += 25) {
            const embed = new EmbedBuilder()
                .setTitle('Training Officer Performance')
                .setColor(0x3498db)
                .addFields(officers.slice(index, index + 25).map(officer => ({
                    name: officer.name,
                    value: `Invites: **${officer.invites}**\nCTO passes: **${officer.ctoPasses}**`,
                    inline: true
                })));

            embeds.push(embed);
        }

        await interaction.reply({ embeds: [embeds[0]] });
        for (const embed of embeds.slice(1)) {
            await interaction.followUp({ embeds: [embed] });
        }
    }
};