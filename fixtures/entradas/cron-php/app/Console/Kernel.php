<?php

namespace App\Console;

use App\Console\Commands\EnviarRecordatorios;
use App\Jobs\Latido;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Foundation\Console\Kernel as ConsoleKernel;

class Kernel extends ConsoleKernel
{
    protected function schedule(Schedule $schedule): void
    {
        $schedule->command('recordatorios:enviar --todos')->dailyAt('09:00')->withoutOverlapping();
        $schedule->command(EnviarRecordatorios::class)->cron('0 */6 * * *');
        $schedule->job(new Latido)->everyFiveMinutes();
        $schedule->call(function () {
            logger('limpieza');
        })->hourly();
    }
}
