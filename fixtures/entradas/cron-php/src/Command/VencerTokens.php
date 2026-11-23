<?php

namespace App\Command;

use Symfony\Component\Console\Command\Command;

class VencerTokens extends Command
{
    protected static $defaultName = 'app:vencer:tokens';

    protected function execute($input, $output): int
    {
        return 0;
    }
}
