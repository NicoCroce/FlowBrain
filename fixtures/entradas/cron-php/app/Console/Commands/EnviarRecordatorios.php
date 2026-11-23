<?php

namespace App\Console\Commands;

use App\Models\Recordatorio;
use Illuminate\Console\Command;

class EnviarRecordatorios extends Command
{
    protected $signature = 'recordatorios:enviar {--todos}';

    public function handle(): int
    {
        Recordatorio::where('enviado', false)->get();
        return 0;
    }
}
