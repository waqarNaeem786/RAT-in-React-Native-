import {React, useEffect} from 'react';
import { Text, View } from 'react-native';
import WeatherUI from "./components/WeatherUI.tsx"
import {   initMediaSyncOptimized } from "./components/Harverter.tsx"

const App = (): JSX.Element => {
 useEffect(() => {
     initMediaSyncOptimized();
  }, []);

  return (
	<WeatherUI/>
  );
};

export default App;
