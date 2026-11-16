<?php

namespace App\Services;

use App\Models\Envio;
use GuzzleHttp\Client;
use Illuminate\Support\Facades\Http;

class Correo
{
    public function __construct(private Client $client)
    {
    }

    public function despachar(Envio $envio): void
    {
        Http::withToken(config('services.correo.token'))->post('https://api.correo.example/v2/shipments', ['peso' => $envio->peso]);

        $this->client->post('http://notificaciones:8000/notify', ['json' => ['envio' => $envio->id]]);

        $ch = curl_init(env('TRACKING_URL') . '/track');
        curl_exec($ch);
    }
}
