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
                        '`/cto` - Post a CTO exam result and close passed records.',
                    ].join('\n')
                },
                {
                    name: 'Training Officeer Commands',
                    value: [
                        '`/cadets edit` - Update a trainee record with PR, MAIN/ALT.',
                        '`/fire` - Post a disciplinary firing note in a cadet thread.',
                        '`/reenlist` - Post a reenlistment note in a cadet thread.',
                        '`/listcadets` - View cadets with rank, country, and last online information.'
                    ].join('\n')
                },
                {
                    name: 'SAPA Command Role Commands',
                    value: [
                        '`/instructor add/remove` - Manage the instructor roster used by officer autocomplete.',
                        '`/performance` - View invite and CTO pass totals by instructor.',
                        '`/blacklist add/remove/search` - Manage the blacklist and view logs for blacklisted users.',
                        '`/refreshlogs` - Manually import recent invite logs into the cadet forum. Please don\'t use this command unless you are sure there are OLD logs to import.'

                    ].join('\n')
                },
                {
                    name: 'How It Works',
                    value: 'Select a trainee by exact name when prompted, then provide the requested officer, rank, and result information. Results are posted to the trainee forum thread.'
                },
                {
                    name: 'Need Access?',
                    value: [
                        'The **Training Officer Role** is used for `/cadets`, `/cto`, `/fire`, `/listcadets`, `/reenlist`, `/training`, and `/performance`.',
                        'The **Training Command Role** is used for `/refreshlogs`, `/update`, `/instructor`, and `/blacklist`.',
                        'If you need access to either role, please contact a bot administrator.'
                    ].join('\n')
                }
            )
            .setColor(0x2f855a)
            .setFooter({ text: 'San Andreas Police Academy' });

        return interaction.reply({ embeds: [helpEmbed], ephemeral: true });
    }
};