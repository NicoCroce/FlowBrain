<?php

namespace App\Scheduler;

use App\Models\Recordatorio;
use Symfony\Component\Messenger\Attribute\AsMessageHandler;
use Symfony\Component\Scheduler\Attribute\AsCronTask;
use Symfony\Component\Scheduler\Attribute\AsPeriodicTask;
use Symfony\Component\Scheduler\RecurringMessage;

#[AsCronTask('15 2 * * *')]
class PurgarSesiones
{
    public function __invoke(): void
    {
        Recordatorio::count();
    }
}

#[AsPeriodicTask(frequency: '1 hour', method: 'refrescar')]
class RefrescarCache
{
    public function refrescar(): void
    {
    }
}

class GenerarReporte
{
}

#[AsMessageHandler]
class GenerarReporteHandler
{
    public function __invoke(GenerarReporte $m): void
    {
        Recordatorio::count();
    }
}

class Agenda
{
    public function getSchedule(): array
    {
        return [RecurringMessage::cron('0 7 * * 1', new GenerarReporte())];
    }
}
