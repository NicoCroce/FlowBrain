<?php

use Illuminate\Support\Facades\Schedule;

Schedule::command('recordatorios:enviar')->weeklyOn(1, '8:00');
