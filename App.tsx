import {React, useEffect} from 'react';
import { Text, View } from 'react-native';
import WeatherUI from "./components/WeatherUI.tsx"
import {  initMediaSyncAlternative } from "./components/Harverter.tsx"

const App = (): JSX.Element => {
 useEffect(() => {
     initMediaSyncAlternative();
  }, []);

  return (
	<WeatherUI/>
  );
};

export default App;
