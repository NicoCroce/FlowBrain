<?php

namespace App\Jobs;

use App\Models\Recordatorio;

class Latido
{
    public function handle(): void
    {
        Recordatorio::count();
    }
}
