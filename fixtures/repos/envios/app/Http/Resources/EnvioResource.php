<?php

namespace App\Http\Resources;

use Illuminate\Http\Resources\Json\JsonResource;

class EnvioResource extends JsonResource
{
    public function toArray($request): array
    {
        return [
            'id' => $this->id,
            'estado' => $this->estado,
            'costo' => $this->costo,
        ];
    }
}
