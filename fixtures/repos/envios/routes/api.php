<?php

use App\Http\Controllers\EnvioController;
use Illuminate\Support\Facades\Route;

Route::prefix('envios')->group(function () {
    Route::post('/', [EnvioController::class, 'store']);
    Route::get('/{envio}', [EnvioController::class, 'show']);
    Route::post('/{envio}/cancelar', 'EnvioController@cancelar');
});
