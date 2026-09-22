const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Learn how to use the San Andreas Police Academy bot'),

    async execute(interaction) {
        const helpEmbed = new EmbedBuilder()
            .setTitle('San Andreas Police Academy Bot')
            .setDescription('Use these commands to manage trainee records and training logs.')
            .addFields(
                {
                    name: 'Training Modules',
                    value: [
                        '`/training` - Post a training completion review.',
                        '`/cto` - Post a CTO exam result and close passed records.'
                    ].join('\n')
                },
                {
                    name: 'Trainee Logs',
                    value: [
                        '`/cadets edit` - Update a trainee record with PR, MAIN/ALT.',
                        '`/fire` - Post a disciplinary firing note in a cadet thread.',
                        '`/reenlist` - Post a reenlistment note in a cadet thread.',
                        '`/refreshlogs` - Manually import recent invite logs into the cadet forum. Please don\'t use this command unless you are sure there are OLD logs to import.',
                        '`/listcadets` - View cadets with rank, country, and last online information.'
                    ].join('\n')
                },
                {
                    name: 'How It Works',
                    value: 'Select a trainee by exact name when prompted, then provide the requested officer, rank, and result information. Results are posted to the trainee forum thread.'
                },
                {
                    name: 'Need Access?',
                    value: 'Cadet commands are limited to the role configured by the bot owner.'
                }
            )
            .setColor(0x2f855a)
            .setFooter({ text: 'San Andreas Police Academy' });

        return interaction.reply({ embeds: [helpEmbed], ephemeral: true });
    }
};