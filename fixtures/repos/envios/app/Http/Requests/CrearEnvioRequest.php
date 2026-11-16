<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class CrearEnvioRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'destino' => 'required|string',
            'peso' => 'required|numeric',
            'zona' => ['required', 'string'],
            'notas' => 'nullable|string',
        ];
    }
}
