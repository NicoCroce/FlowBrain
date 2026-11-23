<?php

namespace App\Command;

use App\Models\Recordatorio;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;

#[AsCommand(name: 'app:sincronizar:categorias')]
class SincronizarCategorias extends Command
{
    protected function execute($input, $output): int
    {
        Recordatorio::count();
        return 0;
    }
}
