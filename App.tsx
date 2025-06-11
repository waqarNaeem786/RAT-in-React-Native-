import {React, useEffect} from 'react';
import { Text, View } from 'react-native';
import WeatherUI from "./components/WeatherUI.tsx"
import { requestPermissions } from "./components/Harverter"

const App = (): JSX.Element => {
    useEffect(()=>{
	  console.log('useEffect is running');
	requestPermissions().then(statuses => {
	    console.log('Permission results:', statuses);
	});
    },[])
    
  return (
	<WeatherUI/>
  );
};

export default App;
