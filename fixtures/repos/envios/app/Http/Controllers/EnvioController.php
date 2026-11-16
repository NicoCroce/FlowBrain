<?php

namespace App\Http\Controllers;

use App\Http\Requests\CrearEnvioRequest;
use App\Http\Resources\EnvioResource;
use App\Models\Envio;
use App\Models\Tarifa;
use App\Services\Correo;

class EnvioController extends Controller
{
    public function __construct(private Correo $correo)
    {
    }

    public function store(CrearEnvioRequest $request): EnvioResource
    {
        $tarifa = Tarifa::where('zona', $request->input('zona'))->first();
        $envio = Envio::create([...$request->validated(), 'costo' => $tarifa->precio]);
        $this->correo->despachar($envio);
        return new EnvioResource($envio);
    }

    public function show(Envio $envio): EnvioResource
    {
        return new EnvioResource($envio);
    }

    public function cancelar(Envio $envio): JsonResponse
    {
        $envio->update(['estado' => 'cancelado']);
        return response()->json(['ok' => true]);
    }
}
