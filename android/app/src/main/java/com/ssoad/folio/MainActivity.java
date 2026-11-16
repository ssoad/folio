package com.ssoad.folio;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.ssoad.folio.ink.FolioInkPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Folio's own native plugins
        registerPlugin(FolioInkPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
